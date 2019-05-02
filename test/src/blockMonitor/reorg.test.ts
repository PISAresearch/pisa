import "mocha";
import { expect } from "chai";
import { ReorgDetector, IBlockStub } from "../../../src/blockMonitor";
import { ethers } from "ethers";
import { mock, when, instance } from "ts-mockito";
import { EventType, Listener } from "ethers/providers";
import { ApplicationError } from "../../../src/dataEntities";
import { MethodStubSetter } from "ts-mockito/lib/MethodStubSetter";

const hashes_a = ["a_hash0", "a_hash1", "a_hash2", "a_hash3", "a_hash4", "a_hash5", "a_hash6", "a_hash7"];
const hashes_b = ["b_hash0", "b_hash1", "b_hash2", "b_hash3", "b_hash4", "b_hash5", "b_hash6", "b_hash7"];
const hashes_c = ["c_hash0", "c_hash1", "c_hash2", "c_hash3", "c_hash4", "c_hash5", "c_hash6", "c_hash7"];
const heights = [0, 1, 2, 3, 4, 5, 6, 7];
const blockStub = (index: number, hashes: string[], parentHashes: string[]): IBlockStub => {
    return {
        hash: hashes[index],
        number: heights[index],
        parentHash: parentHashes[index - 1] ? parentHashes[index - 1] : null
    };
};

// linear chain
// 0-1-2-3-4-5
const a_block0 = blockStub(0, hashes_a, hashes_a) as ethers.providers.Block;
const a_block1 = blockStub(1, hashes_a, hashes_a) as ethers.providers.Block;
const a_block2 = blockStub(2, hashes_a, hashes_a) as ethers.providers.Block;
const a_block3 = blockStub(3, hashes_a, hashes_a) as ethers.providers.Block;
const a_block4 = blockStub(4, hashes_a, hashes_a) as ethers.providers.Block;
const a_block5 = blockStub(5, hashes_a, hashes_a) as ethers.providers.Block;
const a_block6 = blockStub(6, hashes_a, hashes_a) as ethers.providers.Block;

// side chain from 1
// 1-2'
const b_block2 = blockStub(2, hashes_b, hashes_a) as ethers.providers.Block;
const b_block3 = blockStub(3, hashes_b, hashes_b) as ethers.providers.Block;
const b_block4 = blockStub(4, hashes_b, hashes_b) as ethers.providers.Block;
const b_block5 = blockStub(5, hashes_b, hashes_b) as ethers.providers.Block;
const b_block6 = blockStub(6, hashes_b, hashes_b) as ethers.providers.Block;

// side chain from 4-b
const c_block5 = blockStub(5, hashes_c, hashes_b) as ethers.providers.Block;
const c_block6 = blockStub(6, hashes_c, hashes_c) as ethers.providers.Block;

interface IReorgInfo {
    expectedAtBlockNumber: number;
    indexOfNewChainStart: number;
    resetIndex: boolean;
    observed?: boolean;
}

class TestCase {
    constructor(public blocks: IBlockStub[], public reorgs: IReorgInfo[]) {}
    public static linear = () => new TestCase([a_block0, a_block1, a_block2, a_block3, a_block4, a_block5], []);
    public static splitAt1Depth1 = () =>
        new TestCase(
            [a_block0, a_block1, a_block2, b_block2],
            [
                {
                    expectedAtBlockNumber: 1,
                    indexOfNewChainStart: 3,
                    resetIndex: false
                }
            ]
        );
    public static splitAt1Depth2 = () =>
        new TestCase(
            [a_block0, a_block1, a_block2, a_block3, b_block2],
            [
                {
                    expectedAtBlockNumber: 1,
                    indexOfNewChainStart: 4,
                    resetIndex: false
                }
            ]
        );
    public static flipFlop = () =>
        new TestCase(
            [a_block0, a_block1, a_block2, a_block3, b_block2, b_block3, a_block2, a_block3],
            [
                {
                    expectedAtBlockNumber: 1,
                    indexOfNewChainStart: 4,
                    resetIndex: false
                },
                {
                    expectedAtBlockNumber: 1,
                    indexOfNewChainStart: 6,
                    resetIndex: false
                }
            ]
        );

    public static splitAt1Depth5ReorgSplitAgainAt4Depth2Reorg = () =>
        new TestCase(
            [
                a_block0,
                a_block1,
                a_block2,
                a_block3,
                a_block4,
                a_block5,
                a_block6,
                b_block2,
                b_block3,
                b_block4,
                b_block5,
                b_block6,
                c_block5,
                c_block6
            ],
            [
                {
                    expectedAtBlockNumber: 1,
                    indexOfNewChainStart: 7,
                    resetIndex: false
                },
                {
                    expectedAtBlockNumber: 4,
                    indexOfNewChainStart: 12,
                    resetIndex: false
                }
            ]
        );

    async traverse(reorgDetector: ReorgDetector, provider: asyncEmitTestProvider) {
        const findReorgSpec = blockNumber =>
            this.reorgs.filter(r => r.expectedAtBlockNumber === blockNumber && !r.observed)[0];
        let currentReorg;

        reorgDetector.on(ReorgDetector.REORG_END_EVENT, (commonAncestor: number) => {
            // find a reorg with this block number that has not been observed
            const reorg = findReorgSpec(commonAncestor);
            if (!reorg) throw new ApplicationError("Unexpected reorg at " + commonAncestor);
            reorg.resetIndex = true;
            reorg.observed = true;
            currentReorg = reorg;
        });

        let traversalLength = this.blocks.length;

        for (let index = 0; index < traversalLength; index++) {
            if (currentReorg && currentReorg.resetIndex) {
                index = currentReorg.indexOfNewChainStart
                currentReorg.resetIndex = false;
                // reduce the stack size again as we've now adjusted the index
                traversalLength--;
            }
            await provider.asyncEmit("block", this.blocks[index].number);
            if (currentReorg && currentReorg.resetIndex) {
                // temporarily increase the index size to allow for a reorg that
                // happens on the last block
                traversalLength++;
            }
        }
    }

    async testChain(reorgDepth) {
        const { provider, reorgDetector } = ReorgMocks.getSetup(this.blocks, reorgDepth);

        await this.traverse(reorgDetector, provider);

        reorgDetector.stop();
        expect(reorgDetector.head).to.deep.equal(this.blocks[this.blocks.length - 1]);
    }
}

type asyncEmitTestProvider = ethers.providers.BaseProvider & {
    asyncEmit: (event: EventType, ...args: any[]) => Promise<boolean>;
    currentBlock: number;
    currentBlockSet: boolean;
};

class ReorgMocks {
    static getSetup(blocks: IBlockStub[], maxDepth: number) {
        const mockedProvider = mock(ethers.providers.JsonRpcProvider);
        const face: {
            [indexed: number]: MethodStubSetter<Promise<ethers.providers.Block>, ethers.providers.Block, any>;
        } = {};

        for (const key of blocks) {
            if (!face[key.number]) {
                face[key.number] = when(mockedProvider.getBlock(key.number)).thenResolve(key as ethers.providers.Block);
            } else {
                face[key.number] = face[key.number].thenResolve(key as ethers.providers.Block);
            }
            when(mockedProvider.getBlock(key.hash)).thenResolve(key as ethers.providers.Block);
        }

        const provider: asyncEmitTestProvider = instance(mockedProvider) as any;
        ReorgMocks.addProviderFuncs(provider);
        let reorgDetector: ReorgDetector = new ReorgDetector(provider, maxDepth);
        reorgDetector.start();
        return { reorgDetector, provider };
    }

    static addProviderFuncs(asyncProvider: asyncEmitTestProvider) {
        let cachedBlockListener: (blockNumber: number) => void;
        asyncProvider.on = (event: EventType, listener: Listener): ethers.providers.Provider => {
            if (event !== "block") throw new ApplicationError("Block should be the only event subscribed to");
            cachedBlockListener = listener;
            return asyncProvider;
        };
        asyncProvider.asyncEmit = async (event: EventType, ...args: any[]): Promise<boolean> => {
            if (event !== "block") throw new ApplicationError("Block should be the only event emitted");
            await cachedBlockListener(args[0]);
            return true;
        };
        asyncProvider.currentBlock = 0;
        asyncProvider.currentBlockSet = false;
        asyncProvider.resetEventsBlock = (blockNumber: number) => {
            asyncProvider.currentBlock = blockNumber;
        };
    }
}

describe("ReorgDetector", () => {
    const maxDepth = 10;

    it("new block correctly adds genesis", async () => {
        const { provider, reorgDetector } = ReorgMocks.getSetup(TestCase.linear().blocks, maxDepth);
        await provider.asyncEmit("block", 0);
        expect(reorgDetector.head).to.deep.equal(a_block0);
        reorgDetector.stop();
    });

    it("new block does extends chain", async () => {
        await TestCase.linear().testChain(maxDepth);
    });

    it("new block does detects reorg of depth 1", async () => {
        await TestCase.splitAt1Depth1().testChain(maxDepth);
    });

    it("new block does detect reorg when max depth 1 for depth 1 reorg", async () => {
        await TestCase.splitAt1Depth1().testChain(1);
    });

    it("new block does detect reorg of depth 2", async () => {
        await TestCase.splitAt1Depth2().testChain(maxDepth);
    });

    it("new block does detect reorg when max depth 1 for depth 2 reorg", async () => {
        const testCase = TestCase.splitAt1Depth2();
        const { provider, reorgDetector } = ReorgMocks.getSetup(testCase.blocks, 1);

        await testCase.traverse(reorgDetector, provider);

        expect(reorgDetector.head).to.deep.equal(testCase.blocks[3]);
        reorgDetector.stop();
    });

    it("new block does flip flops", async () => {
        await TestCase.flipFlop().testChain(maxDepth);
    });

    it("new block does detect reorg of depth 5, then again at depth 2", async () => {
        await TestCase.splitAt1Depth5ReorgSplitAgainAt4Depth2Reorg().testChain(maxDepth);
    });

    it("new block emits catastrophic reorg")
    it("new block does extend by many")
    it("new block does fire reorg height events upon reorg")
    it("new block does reset events provider upon reorg")
});
