import "mocha";
import { expect } from "chai";
import { BlockProcessor, ReorgHeightListenerStore, BlockCache } from "../../../src/blockMonitor";
import { ethers } from "ethers";
import { mock, when, instance, verify, anything } from "ts-mockito";
import { EventType, Listener } from "ethers/providers";
import { ApplicationError, IBlockStub } from "../../../src/dataEntities";
import { MethodStubSetter } from "ts-mockito/lib/MethodStubSetter";
import { ReorgEmitter } from "../../../src/blockMonitor";

const hashes_a = ["a_hash0", "a_hash1", "a_hash2", "a_hash3", "a_hash4", "a_hash5", "a_hash6", "a_hash7"];
const hashes_b = ["b_hash0", "b_hash1", "b_hash2", "b_hash3", "b_hash4", "b_hash5", "b_hash6", "b_hash7"];
const hashes_c = ["c_hash0", "c_hash1", "c_hash2", "c_hash3", "c_hash4", "c_hash5", "c_hash6", "c_hash7"];
const heights = [0, 1, 2, 3, 4, 5, 6, 7];

const blockStub = (index: number, hashes: string[], parentHashes: string[]): IBlockStub => {
    return {
        hash: hashes[index],
        number: heights[index],
        parentHash: parentHashes[index - 1] || "hashBeforeRootBlock"
        // transactions: []
    };
};

// linear chain
// 0-1-2-3-4-5
const a_block0 = blockStub(0, hashes_a, hashes_a);
const a_block1 = blockStub(1, hashes_a, hashes_a);
const a_block2 = blockStub(2, hashes_a, hashes_a);
const a_block3 = blockStub(3, hashes_a, hashes_a);
const a_block4 = blockStub(4, hashes_a, hashes_a);
const a_block5 = blockStub(5, hashes_a, hashes_a);
const a_block6 = blockStub(6, hashes_a, hashes_a);

// side chain from 1
// 1-2'
const b_block2 = blockStub(2, hashes_b, hashes_a);
const b_block3 = blockStub(3, hashes_b, hashes_b);
const b_block4 = blockStub(4, hashes_b, hashes_b);
const b_block5 = blockStub(5, hashes_b, hashes_b);
const b_block6 = blockStub(6, hashes_b, hashes_b);

// side chain from 4-b
const c_block5 = blockStub(5, hashes_c, hashes_b);
const c_block6 = blockStub(6, hashes_c, hashes_c);

interface IReorgInfo {
    expectedAtBlockNumber: number;
    indexOfNewChainStart: number;
    resetIndex: boolean;
    observed?: boolean;
}

const mockBlockFactory = (provider: ethers.providers.Provider) => async (
    blockNumberOrHash: string | number
): Promise<IBlockStub> => {
    const block = await provider.getBlock(blockNumberOrHash);
    return {
        hash: block.hash,
        number: block.number,
        parentHash: block.parentHash
    };
};
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
            [a_block0, a_block1, a_block2, a_block3, b_block2, b_block3, a_block2, a_block3, a_block4],
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

    public async traverse(reorgEmitter: ReorgEmitter, provider: asyncEmitTestProvider) {
        const findReorgSpec = (blockNumber: number) =>
            this.reorgs.filter(r => r.expectedAtBlockNumber === blockNumber && !r.observed)[0];
        let currentReorg: IReorgInfo | undefined;

        reorgEmitter.on(ReorgEmitter.REORG_END_EVENT, (commonAncestor: number) => {
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
                index = currentReorg.indexOfNewChainStart;
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

    public async testChain(reorgDepth: number) {
        const { provider, blockProcessor, reorgEmitter } = await ReorgMocks.getSetup(this.blocks, reorgDepth);

        await this.traverse(reorgEmitter, provider);

        await Promise.resolve();

        await blockProcessor.stop();
        expect(this.blocks[this.blocks.length - 1]).to.deep.equal(blockProcessor.blockCache.head!);
    }
}

type asyncEmitTestProvider = ethers.providers.BaseProvider & {
    asyncEmit: (event: EventType, ...args: any[]) => Promise<boolean>;
    currentBlock: number;
    currentBlockSet: boolean;
};
class ReorgMocks {
    public static async getSetup(blocks: IBlockStub[], maxDepth: number) {
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

        let provider: asyncEmitTestProvider = instance(mockedProvider) as any;
        provider = ReorgMocks.addProviderFuncs(provider);
        const store = new ReorgHeightListenerStore();
        const blockCache = new BlockCache(maxDepth);
        const blockProcessor: BlockProcessor<IBlockStub> = new BlockProcessor(provider, mockBlockFactory, blockCache);
        await blockProcessor.start();
        const reorgEmitter = new ReorgEmitter(provider, blockProcessor, store);        
        await reorgEmitter.start();
        return { blockCache, blockProcessor, reorgEmitter, provider, store };
    }

    public static addProviderFuncs(asyncProvider: asyncEmitTestProvider) {
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

        // The BlockCache assumes that getBlockNumber is defined at creation time
        asyncProvider.getBlockNumber = () => Promise.resolve(0);

        const newAsyncProvider = Object.keys(asyncProvider).reduce((object: any, key: any) => {
            if (key !== "polling") {
                object[key] = (asyncProvider as any)[key];
            }
            return object;
        }, {});

        Object.defineProperty(newAsyncProvider, "polling", {
            get: function() {},
            set: function(value) {},
            enumerable: true,
            configurable: true
        });

        newAsyncProvider.currentBlock = 0;
        newAsyncProvider.currentBlockSet = false;
        newAsyncProvider.resetEventsBlock = (blockNumber: number) => {
            newAsyncProvider.currentBlockSet = true;
            newAsyncProvider.currentBlock = blockNumber;
        };

        return newAsyncProvider as asyncEmitTestProvider;
    }
}

describe("ReorgEmitter", () => {
    const maxDepth = 10;

    it("new block correctly adds genesis", async () => {
        const { provider, blockProcessor, reorgEmitter } = await ReorgMocks.getSetup(
            TestCase.linear().blocks,
            maxDepth
        );
        await provider.asyncEmit("block", 0);
        await Promise.resolve();

        expect(a_block0).to.deep.equal(reorgEmitter.head!);
        await reorgEmitter.stop();
        await blockProcessor.stop();
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

    it("new block does flip flops", async () => {
        await TestCase.flipFlop().testChain(maxDepth);
    });

    it("new block does detect reorg of depth 5, then again at depth 2", async () => {
        await TestCase.splitAt1Depth5ReorgSplitAgainAt4Depth2Reorg().testChain(maxDepth);
    });

    it("new block emits catastrophic reorg when too deep", async () => {
        const testCase = TestCase.splitAt1Depth5ReorgSplitAgainAt4Depth2Reorg();
        const { provider, blockProcessor, reorgEmitter } = await ReorgMocks.getSetup(testCase.blocks, 2);

        await provider.asyncEmit("block", 0);
        await provider.asyncEmit("block", 1);
        await Promise.resolve();

        const maxDepthFired = new Promise<{ local: IBlockStub; remote: IBlockStub }>((resolve, reject) => {
            reorgEmitter.on(ReorgEmitter.REORG_BEYOND_DEPTH_EVENT, (local: IBlockStub, remote: IBlockStub) => {
                resolve({ local, remote });
            });
        });
        const startReorg = new Promise<number>((resolve, reject) => {
            reorgEmitter.on(ReorgEmitter.REORG_START_EVENT, blockNumber => {
                resolve(blockNumber);
            });
        });
        const endReorg = new Promise<number>((resolve, reject) => {
            reorgEmitter.on(ReorgEmitter.REORG_END_EVENT, blockNumber => {
                resolve(blockNumber);
            });
        });

        await provider.asyncEmit("block", 2);
        await provider.asyncEmit("block", 3);
        await provider.asyncEmit("block", 4);
        await provider.asyncEmit("block", 5);
        await Promise.resolve();

        expect(a_block5).to.deep.equal(reorgEmitter.head!);

        // this will trigger a reorg - and a catastrophic event
        await provider.asyncEmit("block", 5);

        expect(reorgEmitter.head!.hash).to.deep.equal(b_block3.hash);
        expect(reorgEmitter.head!.number).to.deep.equal(b_block3.number);
        expect(reorgEmitter.head!.parentHash).to.deep.equal(b_block3.parentHash);

        const catastrophic = await maxDepthFired;
        expect(a_block5).to.deep.equal(catastrophic.local);
        expect(b_block5).to.deep.equal(catastrophic.remote);
        const startBlock = await startReorg;
        expect(startBlock).to.equal(3);
        const endBlock = await endReorg;
        expect(endBlock).to.equal(3);

        await reorgEmitter.stop();
        await blockProcessor.stop();
    });
    it("new block does extend by many", async () => {
        const testCase = TestCase.linear();
        const { provider, blockProcessor, reorgEmitter } = await ReorgMocks.getSetup(testCase.blocks, maxDepth);
        await provider.asyncEmit("block", 0);
        await Promise.resolve();
        expect(a_block0).to.deep.equal(reorgEmitter.head!);

        await provider.asyncEmit("block", 1);
        await Promise.resolve();
        expect(a_block1).to.deep.equal(reorgEmitter.head!);

        await provider.asyncEmit("block", 4);
        await Promise.resolve();
        expect(a_block4).to.deep.equal(reorgEmitter.head!);
        await reorgEmitter.stop();
        await blockProcessor.stop();
    });
    it("new block does fire reorg height events upon reorg", async () => {
        const testCase = TestCase.flipFlop();
        const { provider, blockProcessor, reorgEmitter } = await ReorgMocks.getSetup(testCase.blocks, maxDepth);

        let fired0 = 0,
            fired1 = 0,
            fired2 = 0;

        await provider.asyncEmit("block", 0);
        await provider.asyncEmit("block", 1);
        await Promise.resolve();

        reorgEmitter.addReorgHeightListener(0, async () => {
            fired0++;
        });
        reorgEmitter.addReorgHeightListener(1, async () => {
            fired1++;
        });
        reorgEmitter.addReorgHeightListener(2, async () => {
            fired2++;
        });

        await provider.asyncEmit("block", 2);
        await Promise.resolve();
        expect(fired0, "did not fire at height 0").to.equal(0);
        expect(fired1, "did not fire at height 1").to.equal(0);
        expect(fired2, "did not fire at height 2").to.equal(0);

        await provider.asyncEmit("block", 2);
        await Promise.resolve();
        expect(fired0, "did not fire at height 0").to.equal(0);
        expect(fired1, "did not fire at height 1").to.equal(0);
        expect(fired2, "fired at height 2").to.equal(1);

        // check that listeners have been removed by triggering reorg again!
        await provider.asyncEmit("block", 2);
        await Promise.resolve();
        expect(fired0, "did not fire at height 0").to.equal(0);
        expect(fired1, "did not fire at height 1").to.equal(0);
        expect(fired2, "fired at height 2").to.equal(1);

        expect(a_block2).to.deep.equal(blockProcessor.blockCache.head!);
        await blockProcessor.stop();
    });
    it("new block emits start, then end, reset events provider upon reorg", async () => {
        const testCase = TestCase.splitAt1Depth2();
        const { provider, blockProcessor, reorgEmitter } = await ReorgMocks.getSetup(testCase.blocks, maxDepth);

        await provider.asyncEmit("block", 0);
        await provider.asyncEmit("block", 1);
        await Promise.resolve();

        const startReorg = new Promise<number>((resolve, reject) => {
            reorgEmitter.on(ReorgEmitter.REORG_START_EVENT, blockNumber => {
                resolve(blockNumber);
            });
        });
        const endReorg = new Promise<number>((resolve, reject) => {
            reorgEmitter.on(ReorgEmitter.REORG_END_EVENT, blockNumber => {
                resolve(blockNumber);
            });
        });

        await provider.asyncEmit("block", 2);
        await provider.asyncEmit("block", 2);
        await Promise.resolve();

        expect(a_block1).to.deep.equal(reorgEmitter.head!);
        await reorgEmitter.stop();
        await blockProcessor.stop();

        const start = await startReorg;
        expect(start).to.equal(1);
        const end = await endReorg;
        expect(end).to.equal(1);

        expect(provider.currentBlockSet).to.be.true;
        // expect to start from the next block - refresh from there
        expect(provider.currentBlock).to.equal(2);
    });
    it("prune does remove blocks and listeners", async () => {
        const testCase = TestCase.linear();
        const { provider, blockProcessor, reorgEmitter, store } = await ReorgMocks.getSetup(testCase.blocks, 2);
        reorgEmitter.addReorgHeightListener(1, async () => {});
        reorgEmitter.addReorgHeightListener(2, async () => {});
        reorgEmitter.addReorgHeightListener(3, async () => {});
        reorgEmitter.addReorgHeightListener(4, async () => {});
        reorgEmitter.addReorgHeightListener(5, async () => {});
        reorgEmitter.addReorgHeightListener(6, async () => {});

        await provider.asyncEmit("block", 1);
        await Promise.resolve();
        expect(a_block1).to.deep.equal(reorgEmitter.head!);
        expect(store.getListenersFromHeight(1).length).to.equal(6);

        await provider.asyncEmit("block", 2);
        await Promise.resolve();
        expect(a_block2).to.deep.equal(reorgEmitter.head!);
        expect(store.getListenersFromHeight(1).length).to.equal(6);

        await provider.asyncEmit("block", 3);
        await Promise.resolve();
        expect(a_block3).to.deep.equal(reorgEmitter.head!);
        expect(store.getListenersFromHeight(1).length).to.equal(6);

        await provider.asyncEmit("block", 4);
        await Promise.resolve();
        expect(a_block4).to.deep.equal(reorgEmitter.head!);
        expect(store.getListenersFromHeight(1).length).to.equal(5);

        await provider.asyncEmit("block", 5);
        await Promise.resolve();
        expect(a_block5).to.deep.equal(reorgEmitter.head!);
        expect(store.getListenersFromHeight(1).length).to.equal(4);

        await reorgEmitter.stop();
        await blockProcessor.stop();
    });
});
