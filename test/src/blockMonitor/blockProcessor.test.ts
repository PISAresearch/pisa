import "mocha";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers } from "ethers";
import { mock, when, instance, anything } from "ts-mockito";
import { EventEmitter } from "events";
import { BlockProcessor, BlockCache, blockStubAndTxFactory } from "../../../src/blockMonitor";
import { IBlockStub } from "../../../src/dataEntities";

chai.use(chaiAsPromised);
const expect = chai.expect;

const blocksByHash: { [key: string]: IBlockStub } = {
    a1: { number: 1, hash: "a1", parentHash: "a0" },
    a2: { number: 2, hash: "a2", parentHash: "a1" },
    a3: { number: 3, hash: "a3", parentHash: "a2" },
    a4: { number: 4, hash: "a4", parentHash: "a3" },
    a5: { number: 5, hash: "a5", parentHash: "a4" },
    a6: { number: 6, hash: "a6", parentHash: "a5" },
    a7: { number: 7, hash: "a7", parentHash: "a6" },
    a8: { number: 8, hash: "a8", parentHash: "a7" },
    a9: { number: 9, hash: "a9", parentHash: "a8" },
    a10: { number: 10, hash: "a10", parentHash: "a9" },
    // A fork
    b3: { number: 3, hash: "b3", parentHash: "a2" },
    b4: { number: 4, hash: "b4", parentHash: "b3" },
    b5: { number: 5, hash: "b5", parentHash: "b4" },
    b6: { number: 6, hash: "b6", parentHash: "b5" },
    b7: { number: 7, hash: "b7", parentHash: "b6" },
    b8: { number: 8, hash: "b8", parentHash: "b7" },
    b9: { number: 9, hash: "b9", parentHash: "b8" },
    b10: { number: 10, hash: "b10", parentHash: "b9" },
    // A fork that goes beyond the maximum depth
    c1: { number: 1, hash: "c1", parentHash: "c0" },
    c2: { number: 2, hash: "c2", parentHash: "c1" },
    c3: { number: 3, hash: "c3", parentHash: "c2" },
    c4: { number: 4, hash: "c4", parentHash: "c3" },
    c5: { number: 5, hash: "c5", parentHash: "c4" },
    c6: { number: 6, hash: "c6", parentHash: "c5" },
    c7: { number: 7, hash: "c7", parentHash: "c6" },
    c8: { number: 8, hash: "c8", parentHash: "c7" },
    c9: { number: 9, hash: "c9", parentHash: "c8" },
    c10: { number: 10, hash: "c10", parentHash: "c9" }
};

describe("BlockProcessor", () => {
    const maxDepth = 5;
    let blockCache: BlockCache<IBlockStub>;
    let blockProcessor: BlockProcessor<IBlockStub>;
    let mockProvider: ethers.providers.BaseProvider;
    let provider: ethers.providers.BaseProvider;

    const createNewBlockSubscriber = (
        bp: BlockProcessor<IBlockStub>,
        bc: BlockCache<IBlockStub>,
        blockHash: string
    ) => {
        return new Promise(resolve => {
            const newBlockHandler = (head: IBlockStub) => {
                if (head.hash === blockHash) {
                    if (!bc.hasBlock(blockHash)) {
                        resolve(new Error(`Expected block with hash ${blockHash} not found in the BlockCache.`));
                    } else {
                        resolve({ number: head.number, hash: head.hash });
                    }
                    bp.off(BlockProcessor.NEW_BLOCK_EVENT, newBlockHandler);
                }
            };

            bp.on(BlockProcessor.NEW_BLOCK_EVENT, newBlockHandler);
        });
    };

    // Instructs the mock provider to switch to the chain given by block `hash` (and its ancestors),
    // then emits the block number corresponding to `hash`.
    function emitBlockHash(hash: string) {
        let curBlockHash: string = hash;
        while (curBlockHash in blocksByHash) {
            const curBlock = blocksByHash[curBlockHash];
            when(mockProvider.getBlock(curBlock.number)).thenResolve(curBlock as ethers.providers.Block);
            curBlockHash = curBlock.parentHash;
        }

        when(mockProvider.getBlockNumber()).thenResolve(blocksByHash[hash].number);

        provider.emit("block", blocksByHash[hash].number);
    }

    beforeEach(async () => {
        blockCache = new BlockCache(maxDepth);

        // Instruct the mocked provider to return the blocks by hash with getBlock
        mockProvider = mock(ethers.providers.BaseProvider);
        for (const [hash, blockStub] of Object.entries(blocksByHash)) {
            when(mockProvider.getBlock(hash)).thenResolve(blockStub as ethers.providers.Block);
        }

        // The mocked Provider should behave like an eventEmitter
        const eventEmitter = new EventEmitter();
        when(mockProvider.on(anything(), anything())).thenCall((arg0: any, arg1: any) => {
            eventEmitter.on(arg0, arg1);
            return provider;
        });
        when(mockProvider.once(anything(), anything())).thenCall((arg0: any, arg1: any) => {
            eventEmitter.once(arg0, arg1);
            return provider;
        });
        when(mockProvider.removeListener(anything(), anything())).thenCall((arg0: any, arg1: any) => {
            eventEmitter.removeListener(arg0, arg1);
            return provider;
        });
        when(mockProvider.removeAllListeners(anything())).thenCall((arg0: any) => {
            eventEmitter.removeAllListeners(arg0);
            return provider;
        });
        when(mockProvider.emit(anything(), anything())).thenCall((arg0: any, arg1: any) =>
            eventEmitter.emit(arg0, arg1)
        );

        // We initially return 0 as the current block number
        when(mockProvider.getBlockNumber()).thenResolve(0);

        provider = instance(mockProvider);
    });

    afterEach(async () => {
        await blockProcessor.stop();
    });

    it("correctly processes the blockchain head after startup", async () => {
        emitBlockHash("a1");

        blockProcessor = new BlockProcessor(provider, blockStubAndTxFactory, blockCache);
        await blockProcessor.start();

        expect(blockProcessor.blockCache.head.hash).to.equal("a1");
    });

    it("adds the first block received to the cache and emits a NEW_HEAD_EVENT after the NEW_BLOCK_EVENTs", async () => {
        emitBlockHash("a4");

        blockProcessor = new BlockProcessor(provider, blockStubAndTxFactory, blockCache);
        await blockProcessor.start();

        let newHeadCalled = false;

        const newHeadPromise = new Promise(resolve => {
            blockProcessor.on(BlockProcessor.NEW_HEAD_EVENT, (head: IBlockStub) => {
                newHeadCalled = true;
                if (!blockCache.hasBlock("a5"))
                    resolve(new Error(`The BlockCache did not have block a5 when its NEW_HEAD_EVENT was emitted`));

                resolve({ number: head.number, hash: head.hash });
            });
        });

        let newHeadCalledBeforeNewBlock = false;
        blockProcessor.once(BlockProcessor.NEW_BLOCK_EVENT, (block: IBlockStub) => {
            if (newHeadCalled) {
                // New head should be the last emitted event
                newHeadCalledBeforeNewBlock = true;
            }
        });

        emitBlockHash("a5");

        const resNewHead = await newHeadPromise;

        expect(newHeadCalledBeforeNewBlock, "did not call NEW_HEAD before NEW_BLOCK").to.be.false;

        return expect(resNewHead).to.deep.equal({ number: 5, hash: "a5" });
    });

    it("adds to the blockCache all ancestors until a known block", async () => {
        blockProcessor = new BlockProcessor(provider, blockStubAndTxFactory, blockCache);

        const subscribers = [];
        for (let i = 1; i <= 5; i++) {
            subscribers.push(createNewBlockSubscriber(blockProcessor, blockCache, `a${i}`));
        }

        emitBlockHash("a1");

        await blockProcessor.start();

        emitBlockHash("a5");

        const results = await Promise.all(subscribers);
        for (let i = 1; i <= 5; i++) {
            expect(results[i - 1]).to.deep.equal({
                number: i,
                hash: `a${i}`
            });
        }
    });

    it("adds both chain until the common ancestor if there is a fork", async () => {
        blockProcessor = new BlockProcessor(provider, blockStubAndTxFactory, blockCache);

        const subscribersA = [];
        for (let i = 1; i <= 6; i++) {
            subscribersA.push(createNewBlockSubscriber(blockProcessor, blockCache, `a${i}`));
        }
        const subscribersB = [];
        for (let i = 3; i <= 6; i++) {
            subscribersB.push(createNewBlockSubscriber(blockProcessor, blockCache, `b${i}`));
        }

        emitBlockHash("a1");

        await blockProcessor.start();

        emitBlockHash("a6");

        const resultsA = await Promise.all(subscribersA);
        for (let i = 1; i <= 6; i++) {
            expect(resultsA[i - 1]).to.deep.equal({
                number: i,
                hash: `a${i}`
            });
        }

        emitBlockHash("b6");

        const resultsB = await Promise.all(subscribersB);
        for (let i = 3; i <= 6; i++) {
            expect(resultsB[i - 3]).to.deep.equal({
                number: i,
                hash: `b${i}`
            });
        }
    });
});
