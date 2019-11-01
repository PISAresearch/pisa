import "mocha";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";

import LevelUp from "levelup";
import EncodingDown from "encoding-down";
import MemDown from "memdown";

import { ethers } from "ethers";
import { mock, when, anything } from "ts-mockito";
import { EventEmitter } from "events";
import { BlockProcessor, BlockCache, blockStubAndTxHashFactory, BlockProcessorStore, IBlockStub, BlockItemStore } from "../src";
import { wait, throwingInstance, fnIt } from "@pisa-research/test-utils";

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

describe("BlockProcessorStore", () => {
    let db: any;
    let store: BlockProcessorStore;

    beforeEach(async () => {
        db = LevelUp(EncodingDown<string, any>(MemDown(), { valueEncoding: "json" }));
        store = new BlockProcessorStore(db);
    });

    it("can set and get the latest head number", async () => {
        await store.setLatestHeadNumber(42);
        expect(await store.getLatestHeadNumber()).to.equal(42);
    });

    fnIt<BlockProcessorStore>(b => b.setLatestHeadNumber, "stores the latest head number in the db", async () => {
        await store.setLatestHeadNumber(42);

        const newStore = new BlockProcessorStore(db); // new store with the same db
        expect(await newStore.getLatestHeadNumber()).to.equal(42);
    });

    fnIt<BlockProcessorStore>(b => b.setLatestHeadNumber, "overwites current head number", async () => {
        await store.setLatestHeadNumber(42);
        await store.setLatestHeadNumber(100);
        expect(await store.getLatestHeadNumber()).to.equal(100);
    });
});

describe("BlockProcessor", () => {
    const maxDepth = 5;
    let db: any;
    let blockStore: BlockItemStore<IBlockStub>;

    let blockCache: BlockCache<IBlockStub>;
    let blockProcessorStore: BlockProcessorStore;
    let blockProcessor: BlockProcessor<IBlockStub>;
    let mockProvider: ethers.providers.BaseProvider;
    let provider: ethers.providers.BaseProvider;

    const createNewBlockSubscriber = (bp: BlockProcessor<IBlockStub>, bc: BlockCache<IBlockStub>, blockHash: string) => {
        return new Promise(resolve => {
            const newBlockHandler = async (block: IBlockStub) => {
                if (block.hash === blockHash) {
                    if (!bc.hasBlock(blockHash)) {
                        resolve(new Error(`Expected block with hash ${blockHash} not found in the BlockCache.`));
                    } else {
                        resolve({ number: block.number, hash: block.hash });
                    }
                    bp.blockCache.newBlock.removeListener(newBlockHandler);
                }
            };

            bp.blockCache.newBlock.addListener(newBlockHandler);
        });
    };

    // Instructs the mock provider to switch to the chain given by block `hash` (and its ancestors),
    // then emits the block number corresponding to `hash`.
    // If `returnNullAtHash` is provided, getBlock will return null for that block hash (simulating a provider failure).
    function emitBlockHash(hash: string, returnNullAtHash: string | null = null, throwErrorAtHash: string | null = null) {
        let curBlockHash: string = hash;
        while (curBlockHash in blocksByHash) {
            const curBlock = blocksByHash[curBlockHash];
            when(mockProvider.getBlock(curBlock.number, anything())).thenResolve(curBlock as ethers.providers.Block);
            when(mockProvider.getBlock(curBlock.hash, anything())).thenResolve(curBlock as ethers.providers.Block);

            curBlockHash = curBlock.parentHash;
        }

        when(mockProvider.getBlockNumber()).thenResolve(blocksByHash[hash].number);

        if (returnNullAtHash != null) {
            when(mockProvider.getBlock(returnNullAtHash, anything())).thenResolve((null as any) as ethers.providers.Block);
        }

        if (throwErrorAtHash != null) {
            when(mockProvider.getBlock(throwErrorAtHash, anything())).thenThrow(new Error("unknown block"));
        }
        provider.emit("block", blocksByHash[hash].number);
    }

    async function startStores() {
        blockStore = new BlockItemStore<IBlockStub>(db);
        await blockStore.start();

        blockCache = new BlockCache(maxDepth, blockStore);

        blockProcessorStore = new BlockProcessorStore(db);
    }

    beforeEach(async () => {
        db = LevelUp(EncodingDown<string, any>(MemDown(), { valueEncoding: "json" }));
        await startStores();

        // Instruct the mocked provider to return the blocks by hash with getBlock
        mockProvider = mock(ethers.providers.BaseProvider);
        for (const [hash, blockStub] of Object.entries(blocksByHash)) {
            when(mockProvider.getBlock(hash, anything())).thenResolve(blockStub as ethers.providers.Block);
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
        when(mockProvider.emit(anything(), anything())).thenCall((arg0: any, arg1: any) => eventEmitter.emit(arg0, arg1));

        // We initially return 0 as the current block number
        when(mockProvider.getBlockNumber()).thenResolve(0);

        provider = throwingInstance(mockProvider);
    });

    afterEach(async () => {
        await blockProcessor.stop();
        await blockStore.stop();
    });

    it("correctly processes the blockchain head after startup", async () => {
        emitBlockHash("a1");

        blockProcessor = new BlockProcessor(provider, blockStubAndTxHashFactory, blockCache, blockStore, blockProcessorStore);
        await blockProcessor.start();

        expect(blockProcessor.blockCache.head.hash).to.equal("a1");
    });

    it("adds the first block received to the cache and emits a new head event after the corresponding new block events from the BlockCache", async () => {
        emitBlockHash("a4");

        blockProcessor = new BlockProcessor(provider, blockStubAndTxHashFactory, blockCache, blockStore, blockProcessorStore);
        await blockProcessor.start();

        let newHeadCalled = false;

        const newHeadPromise = new Promise(resolve => {
            blockProcessor.newHead.addListener(async (head: IBlockStub) => {
                newHeadCalled = true;
                if (!blockCache.hasBlock("a5")) resolve(new Error(`The BlockCache did not have block a5 when its new head event was emitted`));

                resolve({ number: head.number, hash: head.hash });
            });
        });

        let newHeadCalledBeforeNewBlock = false;

        const newBlockListener = async (block: IBlockStub) => {
            if (newHeadCalled) {
                // New head should be the last emitted event
                newHeadCalledBeforeNewBlock = true;
            }
            blockCache.newBlock.removeListener(newBlockListener);
        };
        blockCache.newBlock.addListener(newBlockListener);

        emitBlockHash("a5");

        const resNewHead = await newHeadPromise;

        expect(newHeadCalledBeforeNewBlock, "did not emit new head before the BlockCaches's new block event").to.be.false;

        return expect(resNewHead).to.deep.equal({ number: 5, hash: "a5" });
    });

    it("adds to the blockCache all ancestors until a known block", async () => {
        blockProcessor = new BlockProcessor(provider, blockStubAndTxHashFactory, blockCache, blockStore, blockProcessorStore);

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
        blockProcessor = new BlockProcessor(provider, blockStubAndTxHashFactory, blockCache, blockStore, blockProcessorStore);

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

    // In this test, we simulate a situation where a call to getBlock returns `null` despite being for a block that is known to exists,
    // namely the parent of a known block.
    // This situation occurred in tests on Ropsten using Infura, see https://github.com/PISAresearch/pisa/issues/227.
    it("resumes adding blocks after a previous failure when a new block is emitted", async () => {
        blockProcessor = new BlockProcessor(provider, blockStubAndTxHashFactory, blockCache, blockStore, blockProcessorStore);

        emitBlockHash("a1");

        await blockProcessor.start();

        // Try adding a new head, but fail at block "a3"
        emitBlockHash("a5", "a3");

        await wait(20);

        expect(blockCache.hasBlock("a5", true), "has pending block a5").to.be.true;
        expect(blockCache.hasBlock("a4", true), "has pending block a4").to.be.true;

        expect(blockCache.hasBlock("a3", true), "does not have block a3").to.be.false;

        // Now add successfully
        emitBlockHash("a6");

        await wait(20);

        expect(blockCache.hasBlock("a6", false), "has complete block a6").to.be.true;
        expect(blockCache.hasBlock("a5", false), "has complete block a5").to.be.true;
        expect(blockCache.hasBlock("a4", false), "has complete block a4").to.be.true;
        expect(blockCache.hasBlock("a3", false), "has complete block a3").to.be.true;
    });

    // In this test, we simulate a situation where a call to getBlock throws an exception despite being for a block that is known to exists,
    // namely the parent of a known block.
    // While documentation of ethers.js does not currently state this possibility, this situation occurred in tests on Ropsten using Infura,
    // see https://github.com/PISAresearch/pisa/issues/227.
    it("resumes adding blocks after a previous failure due to getBlock throwing an error when a new block is emitted", async () => {
        blockProcessor = new BlockProcessor(provider, blockStubAndTxHashFactory, blockCache, blockStore, blockProcessorStore);

        emitBlockHash("a1");

        await blockProcessor.start();

        // Try adding a new head, but make getBlock throw an error at block "a3"
        emitBlockHash("a5", null, "a3");

        await wait(20);

        expect(blockCache.hasBlock("a5", true), "has pending block a5").to.be.true;
        expect(blockCache.hasBlock("a4", true), "has pending block a4").to.be.true;

        expect(blockCache.hasBlock("a3", true), "does not have block a3").to.be.false;

        // Now add successfully
        emitBlockHash("a6");

        await wait(20);

        expect(blockCache.hasBlock("a6", false), "has complete block a6").to.be.true;
        expect(blockCache.hasBlock("a5", false), "has complete block a5").to.be.true;
        expect(blockCache.hasBlock("a4", false), "has complete block a4").to.be.true;
        expect(blockCache.hasBlock("a3", false), "has complete block a3").to.be.true;
    });

    it("does not save to db if an event listener throws", async () => {
        blockProcessor = new BlockProcessor(provider, blockStubAndTxHashFactory, blockCache, blockStore, blockProcessorStore);
        emitBlockHash("a1");
        await blockProcessor.start();
        blockProcessor.newHead.addListener(async (block: IBlockStub) => {
            if (block.hash === "a3") throw new Error("Some very serious error");
        });

        emitBlockHash("a2"); // OK
        await wait(20);

        emitBlockHash("a3"); // listener throws an error
        await wait(20);

        // Now tear down and restart everything
        await blockProcessor.stop();
        await blockStore.stop();

        await startStores();

        await blockProcessor.start();

        // The store should still be at a2, not a3.
        expect(await blockProcessorStore.getLatestHeadNumber()).to.equal(2);
    });
});
