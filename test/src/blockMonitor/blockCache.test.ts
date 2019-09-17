import "mocha";
import { expect } from "chai";
import { BlockCache, getConfirmations } from "../../../src/blockMonitor";
import { ArgumentError, IBlockStub, TransactionHashes, ApplicationError, BlockItemStore } from "../../../src/dataEntities";
import fnIt from "../../utils/fnIt";
import { BlockAddResult } from "../../../src/blockMonitor/blockCache";

import LevelUp from "levelup";
import EncodingDown from "encoding-down";
import MemDown from "memdown";

function generateBlocks(
    nBlocks: number,
    initialHeight: number,
    chain: string,
    rootParentHash?: string | null // if given, the parentHash of the first block in the returned chain
): (IBlockStub & TransactionHashes)[] {
    const result: (IBlockStub & TransactionHashes)[] = [];
    for (let height = initialHeight; height < initialHeight + nBlocks; height++) {
        const transactions: string[] = [];
        for (let i = 0; i < 5; i++) {
            transactions.push(`${chain}-block${height}tx${i + 1}`);
        }

        const block = {
            number: height,
            hash: `hash-${chain}-${height}`,
            parentHash: rootParentHash != null && height === initialHeight ? rootParentHash : `hash-${chain}-${height - 1}`,
            transactionHashes: transactions
        };

        result.push(block as (IBlockStub & TransactionHashes));
    }
    return result;
}

// simple class to monitor and record BlockCaches's new block events
class NewBlockSpy {
    private mCallCounter = 0;
    public get callCounter() {
        return this.mCallCounter;
    }
    private mLastCallBlock: IBlockStub | null = null;
    public get lastCallBlock() {
        return this.mLastCallBlock;
    }

    public newBlockListener = async (block: IBlockStub) => {
        this.mCallCounter++;
        this.mLastCallBlock = block;
    };
}

describe("BlockCache", () => {
    const maxDepth = 10;
    let db: any;
    let blockStore: BlockItemStore<IBlockStub>;
    beforeEach(async () => {
        db = LevelUp(EncodingDown<string, any>(MemDown(), { valueEncoding: "json" }));
        blockStore = new BlockItemStore<IBlockStub>(db);
        await blockStore.start();
    });

    afterEach(async () => await blockStore.stop());

    it("records a block that was just added", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(1, 0, "main");

        await bc.addBlock(blocks[0]);

        expect(blocks[0]).to.deep.include(bc.getBlock(blocks[0].hash));
    });

    fnIt<BlockCache<any>>(b => b.addBlock, "adds blocks that are attached and returns Added", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(10, 5, "main");
        expect(await bc.addBlock(blocks[0])).to.equal(BlockAddResult.Added);
        expect(await bc.addBlock(blocks[1])).to.equal(BlockAddResult.Added);
        expect(await bc.addBlock(blocks[2])).to.equal(BlockAddResult.Added);
    });

    fnIt<BlockCache<any>>(b => b.addBlock, "adds unattached blocks and returns false", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(10, 5, "main");
        await bc.addBlock(blocks[0]);
        expect(await bc.addBlock(blocks[3])).to.equal(BlockAddResult.AddedDetached);
        expect(await bc.addBlock(blocks[2])).to.equal(BlockAddResult.AddedDetached);
    });

    it("emits a new block event when a new block is added and attached", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(10, 5, "main");

        const newBlockSpy = new NewBlockSpy();
        bc.newBlock.addListener(newBlockSpy.newBlockListener);

        await bc.addBlock(blocks[0]);

        expect(newBlockSpy.callCounter).to.equal(1);
        expect(newBlockSpy.lastCallBlock).to.equal(blocks[0]);
    });

    it("does not emit a new block event when a new block is added unattached", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(10, 5, "main");
        await bc.addBlock(blocks[0]);

        const newBlockSpy = new NewBlockSpy();
        bc.newBlock.addListener(newBlockSpy.newBlockListener);

        await bc.addBlock(blocks[2]); //unattached block

        expect(newBlockSpy.callCounter).to.equal(0);
    });

    it("emits a new block event when an unattached block becomes attached", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(10, 5, "main");
        await bc.addBlock(blocks[0]);

        const newBlockSpy = new NewBlockSpy();
        bc.newBlock.addListener(newBlockSpy.newBlockListener);

        await bc.addBlock(blocks[2]); //unattached block
        await bc.addBlock(blocks[1]); //now both blocks become attached

        expect(newBlockSpy.callCounter).to.equal(2);
        expect(newBlockSpy.lastCallBlock).to.deep.equal(blocks[2]);
    });

    fnIt<BlockCache<any>>(b => b.hasBlock, "returns true for an existing attached block", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(10, 5, "main");
        await bc.addBlock(blocks[0]);
        await bc.addBlock(blocks[1]);
        expect(bc.hasBlock(blocks[1].hash)).to.be.true;
    });

    fnIt<BlockCache<any>>(b => b.hasBlock, "returns false for a non-existing block", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(10, 5, "main");
        await bc.addBlock(blocks[0]);
        await bc.addBlock(blocks[1]);
        expect(bc.hasBlock("someNonExistingHash")).to.be.false;
    });

    fnIt<BlockCache<any>>(b => b.hasBlock, "returns false for an unattached block if allowPending=false", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(10, 5, "main");
        await bc.addBlock(blocks[0]);
        await bc.addBlock(blocks[1]);
        await bc.addBlock(blocks[3]);
        expect(bc.hasBlock(blocks[3].hash, false)).to.be.false;
    });

    fnIt<BlockCache<any>>(b => b.hasBlock, "returns true for an unattached block if allowPending=true", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(10, 5, "main");
        await bc.addBlock(blocks[0]);
        await bc.addBlock(blocks[1]);
        await bc.addBlock(blocks[3]);
        expect(bc.hasBlock(blocks[3].hash, true)).to.be.true;
    });

    fnIt<BlockCache<any>>(b => b.addBlock, "makes sure that a previously unattached block becomes attached if appropriate", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(10, 5, "main");
        await bc.addBlock(blocks[0]);
        await bc.addBlock(blocks[3]);
        await bc.addBlock(blocks[2]);

        expect(await bc.addBlock(blocks[1])).to.equal(BlockAddResult.Added);

        expect(bc.maxHeight).to.equal(blocks[3].number);
        expect(bc.hasBlock(blocks[3].hash)).to.be.true;
    });

    it("maxHeight does not change for unattached blocks", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(10, 5, "main");
        await bc.addBlock(blocks[0]);
        await bc.addBlock(blocks[3]);
        expect(bc.maxHeight).to.equal(blocks[0].number);
    });

    fnIt<BlockCache<any>>(b => b.getBlock, "returns an attached block", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(10, 5, "main");
        await bc.addBlock(blocks[0]);
        await bc.addBlock(blocks[1]);
        await bc.addBlock(blocks[3]);
        expect(bc.getBlock(blocks[1].hash)).to.deep.equal(blocks[1]);
    });

    fnIt<BlockCache<any>>(b => b.getBlock, "returns an unattached block", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(10, 5, "main");
        await bc.addBlock(blocks[0]);
        await bc.addBlock(blocks[1]);
        await bc.addBlock(blocks[3]);
        expect(bc.getBlock(blocks[3].hash)).to.deep.equal(blocks[3]);
    });

    fnIt<BlockCache<any>>(b => b.getBlock, "throws ApplicationError for an unknown block", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(10, 5, "main");
        await bc.addBlock(blocks[0]);
        await bc.addBlock(blocks[1]);
        await bc.addBlock(blocks[3]);
        expect(() => bc.getBlock("someNonExistingHash")).to.throw(ApplicationError);
    });

    it("minHeight is equal to the initial block height if less then maxDepth blocks are added", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const initialHeight = 3;
        const blocks = generateBlocks(maxDepth - 1, initialHeight, "main");

        for (const block of blocks) {
            await bc.addBlock(block);
        }

        expect(bc.minHeight).to.equal(initialHeight);
    });

    it("minHeight is equal to the height of the highest added block minus maxDepth if more than maxDepth blocks are added", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const initialHeight = 3;
        const blocksAdded = 2 * maxDepth;
        const lastBlockAdded = initialHeight + blocksAdded - 1;
        const blocks = generateBlocks(blocksAdded, initialHeight, "main");
        for (const block of blocks) {
            await bc.addBlock(block);
        }
        expect(bc.minHeight).to.equal(lastBlockAdded - maxDepth);
    });

    it("maxHeight is equal to the height of the highest added block", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const initialHeight = 3;
        const blocksAdded = 2 * maxDepth;
        const lastBlockAdded = initialHeight + blocksAdded - 1;

        // Add some blocks
        for (const block of generateBlocks(blocksAdded, initialHeight, "main")) {
            await bc.addBlock(block);
        }
        // Add a shorter separate chain
        for (const block of generateBlocks(blocksAdded - 1, initialHeight, "forkedchain")) {
            await bc.addBlock(block);
        }

        expect(bc.maxHeight).to.equal(lastBlockAdded);
    });

    fnIt<BlockCache<any>>(b => b.canAttachBlock, "returns true for blocks whose height is equal to the initial height", async () => {
        const bc = new BlockCache(maxDepth, blockStore);

        const blocks = generateBlocks(10, 5, "main");
        const otherBlocks = generateBlocks(10, 5, "other");

        await bc.addBlock(blocks[3]);

        expect(bc.canAttachBlock(blocks[3])).to.be.true;
        expect(bc.canAttachBlock(otherBlocks[3])).to.be.true;
    });

    fnIt<BlockCache<any>>(b => b.canAttachBlock, "returns false for blocks whose height is lower than the initial height", async () => {
        const bc = new BlockCache(maxDepth, blockStore);

        const blocks = generateBlocks(10, 5, "main");
        const otherBlocks = generateBlocks(10, 5, "other");

        await bc.addBlock(blocks[3]);

        expect(bc.canAttachBlock(blocks[2])).to.be.false;
        expect(bc.canAttachBlock(otherBlocks[2])).to.be.false;
    });

    fnIt<BlockCache<any>>(b => b.canAttachBlock, "returns true for a block whose height is equal to the maximum depth", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const initialHeight = 3;
        const blocksAdded = maxDepth + 1;
        const blocks = generateBlocks(blocksAdded, initialHeight, "main");
        for (const block of blocks) {
            await bc.addBlock(block);
        }
        const otherBlocks = generateBlocks(2, initialHeight - 1, "main");

        expect(bc.canAttachBlock(otherBlocks[1])).to.be.true;
    });

    fnIt<BlockCache<any>>(b => b.canAttachBlock, "returns false for blocks whose height is lower than the maximum depth", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const initialHeight = 3;
        const blocksAdded = maxDepth + 1;
        const blocks = generateBlocks(blocksAdded, initialHeight, "main");
        for (const block of blocks) {
            await bc.addBlock(block);
        }
        const otherBlocks = generateBlocks(2, initialHeight - 1, "main");

        expect(bc.canAttachBlock(otherBlocks[0])).to.be.false;
    });

    fnIt<BlockCache<any>>(b => b.canAttachBlock, "returns true for a block whose parent is in the BlockCache", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(10, 7, "main");

        await bc.addBlock(blocks[5]);

        expect(bc.canAttachBlock(blocks[6])).to.be.true;
    });

    fnIt<BlockCache<any>>(b => b.canAttachBlock, "returns false for a block above minHeight whose parent is not in the BlockCache", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(10, 7, "main");

        await bc.addBlock(blocks[0]);
        await bc.addBlock(blocks[1]);
        await bc.addBlock(blocks[2]);

        expect(bc.canAttachBlock(blocks[4])).to.be.false;
    });

    it("records blocks until maximum depth", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(maxDepth, 0, "main");
        for (const block of blocks) {
            await bc.addBlock(block);
        }
        expect(blocks[0]).to.deep.include(bc.getBlock(blocks[0].hash));
    });

    it("forgets blocks past the maximum depth", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(maxDepth + 2, 0, "main"); // head is depth 0, so first pruned is maxDepth + 2
        for (const block of blocks) {
            await bc.addBlock(block);
        }
        expect(() => bc.getBlock(blocks[0].hash)).to.throw(ApplicationError);
    });

    fnIt<BlockCache<any>>(b => b.ancestry, "iterates over all the ancestors", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(10, 0, "main");
        for (const block of blocks) {
            await bc.addBlock(block);
        }
        const headBlock = blocks[blocks.length - 1];

        // Add some other blocks in a forked chain at height 3
        for (const block of generateBlocks(5, 3, "fork", blocks[1].hash)) {
            await bc.addBlock(block);
        }

        const result = [...bc.ancestry(headBlock.hash)];
        result.reverse();

        expect(result).to.deep.equal(blocks);
    });

    fnIt<BlockCache<any>>(b => b.findAncestor, "returns the nearest ancestor that satisfies the predicate", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(5, 0, "main");
        for (const block of blocks) {
            await bc.addBlock(block);
        }
        const headBlock = blocks[blocks.length - 1];

        const result = bc.findAncestor(headBlock.hash, block => block.hash == blocks[2].hash);
        expect(result).to.not.be.null;
        expect(blocks[2]).to.deep.include(result!);
    });

    fnIt<BlockCache<any>>(b => b.findAncestor, "returns self if satisfies the predicate", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(5, 0, "main");
        for (const block of blocks) {
            await bc.addBlock(block);
        }
        const headBlock = blocks[blocks.length - 1];

        const result = bc.findAncestor(headBlock.hash, block => block.hash == headBlock.hash);
        expect(result).to.not.be.null;
        expect(headBlock).to.deep.include(result!);
    });

    fnIt<BlockCache<any>>(b => b.findAncestor, "returns self if satisfies the predicate", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(5, 0, "main");
        for (const block of blocks) {
            await bc.addBlock(block);
        }
        const headBlock = blocks[blocks.length - 1];

        const result = bc.findAncestor(headBlock.hash, block => block.hash == "notExistingHash");
        expect(result).to.be.null;
    });

    fnIt<BlockCache<any>>(b => b.findAncestor, "does not return at height less than minHeight", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(5, 0, "main");
        for (const block of blocks) {
            await bc.addBlock(block);
        }
        const headBlock = blocks[blocks.length - 1];

        // condition is true only for a block at height strictly below minHeight
        const result = bc.findAncestor(headBlock.hash, block => block.number === blocks[3].number, blocks[3].number + 1);
        expect(result).to.be.null;
    });

    fnIt<BlockCache<any>>(b => b.findAncestor, "does return at height equal or more than minHeight", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(5, 0, "main");
        for (const block of blocks) {
            await bc.addBlock(block);
        }
        const headBlock = blocks[blocks.length - 1];

        // condition is true only for blocks at height exactly minHeight
        const result = bc.findAncestor(headBlock.hash, block => block.number === blocks[3].number, blocks[3].number);
        expect(result).to.not.be.null;
        expect(blocks[3]).to.deep.include(result!);
    });

    fnIt<BlockCache<any>>(b => b.getOldestAncestorInCache, "returns the deepest ancestor", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(5, 0, "main");
        for (const block of blocks) {
            await bc.addBlock(block);
        }
        const headBlock = blocks[blocks.length - 1];

        const result = bc.getOldestAncestorInCache(headBlock.hash);
        expect(blocks[0]).to.deep.include(result);
    });

    fnIt<BlockCache<any>>(b => b.getOldestAncestorInCache, "throws ArgumentError for a hash not in cache", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(5, 0, "main");
        for (const block of blocks) {
            await bc.addBlock(block);
        }
        expect(() => bc.getOldestAncestorInCache("notExistingHash")).to.throw(ArgumentError);
    });

    fnIt<BlockCache<any>>(b => b.setHead, "correctly sets new head", async () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(1, 0, "main");

        await bc.addBlock(blocks[0]);
        bc.setHead(blocks[0].hash);
        expect(bc.head).to.deep.equal(blocks[0]);
    });

    fnIt<BlockCache<any>>(b => b.setHead, "setHead throws for head not in cache", () => {
        const bc = new BlockCache(maxDepth, blockStore);
        const blocks = generateBlocks(1, 0, "main");

        expect(() => bc.setHead(blocks[0].hash)).to.throw(ArgumentError);
    });

    it("head throws if setHead never called", () => {
        const bc = new BlockCache(maxDepth, blockStore);
        expect(() => bc.head).to.throw(ApplicationError);
    });
});

describe("getConfirmations", () => {
    const maxDepth = 100;

    let db: any;
    let blockStore: BlockItemStore<IBlockStub & TransactionHashes>;
    beforeEach(() => {
        db = LevelUp(EncodingDown<string, any>(MemDown(), { valueEncoding: "json" }));
        blockStore = new BlockItemStore<IBlockStub & TransactionHashes>(db);
    });

    it("correctly computes the number of confirmations for a transaction", async () => {
        const bc = new BlockCache<IBlockStub & TransactionHashes>(maxDepth, blockStore);
        const blocks = generateBlocks(7, 0, "main"); // must be less blocks than maxDepth
        for (const block of blocks) {
            await bc.addBlock(block);
        }
        const headBlock = blocks[blocks.length - 1];
        expect(getConfirmations(bc, headBlock.hash, blocks[0].transactionHashes[0])).to.equal(blocks.length);
        expect(getConfirmations(bc, headBlock.hash, blocks[1].transactionHashes[0])).to.equal(blocks.length - 1);
    });

    it("correctly returns 0 confirmations if transaction is not known", async () => {
        const bc = new BlockCache<IBlockStub & TransactionHashes>(maxDepth, blockStore);
        const blocks = generateBlocks(128, 0, "main");
        for (const block of blocks) {
            await bc.addBlock(block);
        }

        const headBlock = blocks[blocks.length - 1];
        expect(getConfirmations(bc, headBlock.hash, "nonExistingTxHash")).to.equal(0);
    });

    it("throws ArgumentError if no block with the given hash is in the BlockCache", async () => {
        const bc = new BlockCache<IBlockStub & TransactionHashes>(maxDepth, blockStore);
        const blocks = generateBlocks(128, 0, "main");
        for (const block of blocks) {
            await bc.addBlock(block);
        }

        const headBlock = blocks[blocks.length - 1];
        expect(() => getConfirmations(bc, "nonExistingBlockHash", headBlock.transactionHashes[0])).to.throw(ApplicationError);
    });
});
