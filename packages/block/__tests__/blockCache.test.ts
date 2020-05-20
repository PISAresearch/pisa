import "mocha";
import { expect } from "chai";
import { BlockAddResult, BlockCache, IBlockStub, TransactionHashes, BlockItemStore } from "../src";
import { ArgumentError, ApplicationError } from "@pisa-research/errors";
import { DbObject, defaultSerialiser, Logger } from "@pisa-research/utils";
import { fnIt } from "@pisa-research/test-utils";

import LevelUp from "levelup";
import EncodingDown from "encoding-down";
import MemDown from "memdown";

const logger = Logger.getLogger();

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

        result.push(block as IBlockStub & TransactionHashes);
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
    let bc: BlockCache<IBlockStub>;

    let resolveBatch: (value?: any) => void;

    beforeEach(async () => {
        db = LevelUp(
            EncodingDown<string, DbObject>(MemDown(), { valueEncoding: "json" })
        );
        blockStore = new BlockItemStore<IBlockStub>(db, defaultSerialiser, logger);
        await blockStore.start();

        bc = new BlockCache(maxDepth, blockStore);

        // Create a batch that will be closed in the afterEach block, as the BlockCache assumes the batch is already open
        blockStore.withBatch(
            () =>
                new Promise(resolve => {
                    resolveBatch = resolve;
                })
        );
    });

    afterEach(async () => {
        resolveBatch();
        await Promise.resolve();

        await blockStore.stop();
    });

    it("records a block that was just added", async () => {
        const blocks = generateBlocks(1, 0, "main");

        await bc.addBlock(blocks[0]);

        expect(blocks[0]).to.deep.include(bc.getBlock(blocks[0].hash));
    });

    fnIt<BlockCache<any>>(
        b => b.addBlock,
        "adds blocks that are attached and returns Added",
        async () => {
            const blocks = generateBlocks(10, 5, "main");
            expect(await bc.addBlock(blocks[0])).to.equal(BlockAddResult.Added);
            expect(await bc.addBlock(blocks[1])).to.equal(BlockAddResult.Added);
            expect(await bc.addBlock(blocks[2])).to.equal(BlockAddResult.Added);
        }
    );

    fnIt<BlockCache<any>>(
        b => b.addBlock,
        "adds unattached blocks and returns false",
        async () => {
            const blocks = generateBlocks(10, 5, "main");
            await bc.addBlock(blocks[0]);
            expect(await bc.addBlock(blocks[3])).to.equal(BlockAddResult.AddedDetached);
            expect(await bc.addBlock(blocks[2])).to.equal(BlockAddResult.AddedDetached);
        }
    );

    it("emits a new block event when a new block is added and attached", async () => {
        const blocks = generateBlocks(10, 5, "main");

        const newBlockSpy = new NewBlockSpy();
        bc.newBlock.addListener(newBlockSpy.newBlockListener);

        await bc.addBlock(blocks[0]);

        expect(newBlockSpy.callCounter).to.equal(1);
        expect(newBlockSpy.lastCallBlock).to.equal(blocks[0]);
    });

    it("does not emit a new block event when a new block is added unattached", async () => {
        const blocks = generateBlocks(10, 5, "main");
        await bc.addBlock(blocks[0]);

        const newBlockSpy = new NewBlockSpy();
        bc.newBlock.addListener(newBlockSpy.newBlockListener);

        await bc.addBlock(blocks[2]); //unattached block

        expect(newBlockSpy.callCounter).to.equal(0);
    });

    it("emits a new block event when an unattached block becomes attached", async () => {
        const blocks = generateBlocks(10, 5, "main");
        await bc.addBlock(blocks[0]);

        const newBlockSpy = new NewBlockSpy();
        bc.newBlock.addListener(newBlockSpy.newBlockListener);

        await bc.addBlock(blocks[2]); //unattached block
        await bc.addBlock(blocks[1]); //now both blocks become attached

        expect(newBlockSpy.callCounter).to.equal(2);
        expect(newBlockSpy.lastCallBlock).to.deep.equal(blocks[2]);
    });

    fnIt<BlockCache<any>>(
        b => b.hasBlock,
        "returns true for an existing attached block",
        async () => {
            const blocks = generateBlocks(10, 5, "main");
            await bc.addBlock(blocks[0]);
            await bc.addBlock(blocks[1]);
            expect(bc.hasBlock(blocks[1].hash)).to.be.true;
        }
    );

    fnIt<BlockCache<any>>(
        b => b.hasBlock,
        "returns false for a non-existing block",
        async () => {
            const blocks = generateBlocks(10, 5, "main");
            await bc.addBlock(blocks[0]);
            await bc.addBlock(blocks[1]);
            expect(bc.hasBlock("someNonExistingHash")).to.be.false;
        }
    );

    fnIt<BlockCache<any>>(
        b => b.hasBlock,
        "returns false for an unattached block if allowPending=false",
        async () => {
            const blocks = generateBlocks(10, 5, "main");
            await bc.addBlock(blocks[0]);
            await bc.addBlock(blocks[1]);
            await bc.addBlock(blocks[3]);
            expect(bc.hasBlock(blocks[3].hash, false)).to.be.false;
        }
    );

    fnIt<BlockCache<any>>(
        b => b.hasBlock,
        "returns true for an unattached block if allowPending=true",
        async () => {
            const blocks = generateBlocks(10, 5, "main");
            await bc.addBlock(blocks[0]);
            await bc.addBlock(blocks[1]);
            await bc.addBlock(blocks[3]);
            expect(bc.hasBlock(blocks[3].hash, true)).to.be.true;
        }
    );

    fnIt<BlockCache<any>>(
        b => b.addBlock,
        "makes sure that a previously unattached block becomes attached if appropriate",
        async () => {
            const blocks = generateBlocks(10, 5, "main");
            await bc.addBlock(blocks[0]);
            await bc.addBlock(blocks[3]);
            await bc.addBlock(blocks[2]);

            expect(await bc.addBlock(blocks[1])).to.equal(BlockAddResult.Added);

            expect(bc.maxHeight).to.equal(blocks[3].number);
            expect(bc.hasBlock(blocks[3].hash)).to.be.true;
        }
    );

    fnIt<BlockCache<any>>(
        b => b.addBlock,
        "does not cause unattached blocks to be emitted if another unattached block at the same height becomes attached",
        async () => {
            const blocksCommon = generateBlocks(3, 5, "main");
            const lastCommonBlock = blocksCommon[blocksCommon.length - 1];
            const blocksBranch1 = generateBlocks(2, lastCommonBlock.number + 1, "fork1", lastCommonBlock.hash);
            const blocksBranch2 = generateBlocks(2, lastCommonBlock.number + 1, "fork2", lastCommonBlock.hash);

            for (const b of blocksCommon) await bc.addBlock(b);

            await bc.addBlock(blocksBranch1[1]); // detached block in fork 1
            await bc.addBlock(blocksBranch2[1]); // detached block in fork 2

            await bc.addBlock(blocksBranch1[0]); // blocks in fork 1 should become attached, but the second block of branch 2 shouldn't!

            expect(bc.hasBlock(blocksBranch1[0].hash)).to.be.true;
            expect(bc.hasBlock(blocksBranch1[1].hash)).to.be.true;

            expect(bc.hasBlock(blocksBranch2[1].hash)).to.be.false;
            expect(bc.hasBlock(blocksBranch2[1].hash, true)).to.be.true;
        }
    );


    it("maxHeight does not change for unattached blocks", async () => {
        const blocks = generateBlocks(10, 5, "main");
        await bc.addBlock(blocks[0]);
        await bc.addBlock(blocks[3]);
        expect(bc.maxHeight).to.equal(blocks[0].number);
    });

    fnIt<BlockCache<any>>(
        b => b.getBlock,
        "returns an attached block",
        async () => {
            const blocks = generateBlocks(10, 5, "main");
            await bc.addBlock(blocks[0]);
            await bc.addBlock(blocks[1]);
            await bc.addBlock(blocks[3]);
            expect(bc.getBlock(blocks[1].hash)).to.deep.equal(blocks[1]);
        }
    );

    fnIt<BlockCache<any>>(
        b => b.getBlock,
        "returns an unattached block",
        async () => {
            const blocks = generateBlocks(10, 5, "main");
            await bc.addBlock(blocks[0]);
            await bc.addBlock(blocks[1]);
            await bc.addBlock(blocks[3]);
            expect(bc.getBlock(blocks[3].hash)).to.deep.equal(blocks[3]);
        }
    );

    fnIt<BlockCache<any>>(
        b => b.getBlock,
        "throws ApplicationError for an unknown block",
        async () => {
            const blocks = generateBlocks(10, 5, "main");
            await bc.addBlock(blocks[0]);
            await bc.addBlock(blocks[1]);
            await bc.addBlock(blocks[3]);
            expect(() => bc.getBlock("someNonExistingHash")).to.throw(ApplicationError);
        }
    );

    it("minHeight is equal to maxHeight minus max depth", async () => {
        const initialHeight = 3;
        const blocks = generateBlocks(maxDepth - 1, initialHeight, "main");

        for (const block of blocks) {
            await bc.addBlock(block);
        }

        expect(bc.minHeight).to.equal(initialHeight + (blocks.length - 1) - maxDepth);
        expect(bc.minHeight).to.equal(bc.maxHeight - maxDepth);
    });

    it("minHeight is equal to the height of the highest added block minus maxDepth if more than maxDepth blocks are added", async () => {
        const initialHeight = 3;
        const blocksAdded = 2 * maxDepth;
        const blocks = generateBlocks(blocksAdded, initialHeight, "main");
        for (const block of blocks) {
            await bc.addBlock(block);
        }

        expect(bc.minHeight).to.equal(blocks[blocks.length - 1].number - maxDepth);
    });

    it("maxHeight is equal to the height of the highest added block", async () => {
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

    fnIt<BlockCache<any>>(
        b => b.canAttachBlock,
        "returns true for a block whose height is equal to the max height - max depth",
        async () => {
            const initialHeight = 3;
            const blocksAdded = maxDepth + 1;
            const blocks = generateBlocks(blocksAdded, initialHeight, "main");
            for (const block of blocks) {
                await bc.addBlock(block);
            }
            const otherBlocks = generateBlocks(1, initialHeight, "other");

            expect(otherBlocks[0].number).to.eq(bc.maxHeight - bc.maxDepth);
            expect(bc.canAttachBlock(otherBlocks[0])).to.be.true;
        }
    );

    fnIt<BlockCache<any>>(
        b => b.canAttachBlock,
        "returns false for blocks whose height is lower than the maximum depth",
        async () => {
            const initialHeight = 3;
            const blocksAdded = maxDepth + 1;
            const blocks = generateBlocks(blocksAdded, initialHeight, "main");
            for (const block of blocks) {
                await bc.addBlock(block);
            }
            const otherBlocks = generateBlocks(2, initialHeight - 1, "main");

            expect(bc.canAttachBlock(otherBlocks[0])).to.be.false;
        }
    );

    fnIt<BlockCache<any>>(
        b => b.canAttachBlock,
        "returns true for a block whose parent is in the BlockCache",
        async () => {
            const blocks = generateBlocks(10, 7, "main");

            await bc.addBlock(blocks[5]);

            expect(bc.canAttachBlock(blocks[6])).to.be.true;
        }
    );

    fnIt<BlockCache<any>>(
        b => b.canAttachBlock,
        "returns false for a block above minHeight whose parent is not in the BlockCache",
        async () => {
            const blocks = generateBlocks(10, 7, "main");

            await bc.addBlock(blocks[0]);
            await bc.addBlock(blocks[1]);
            await bc.addBlock(blocks[2]);

            expect(bc.canAttachBlock(blocks[4])).to.be.false;
        }
    );

    it("records blocks until maximum depth", async () => {
        const blocks = generateBlocks(maxDepth, 0, "main");
        for (const block of blocks) {
            await bc.addBlock(block);
        }
        expect(blocks[0]).to.deep.include(bc.getBlock(blocks[0].hash));
    });

    it("forgets blocks past the maximum depth", async () => {
        const blocks = generateBlocks(maxDepth + 2, 0, "main"); // head is depth 0, so first pruned is maxDepth + 2
        for (let index = 0; index < blocks.length; index++) {
            const block = blocks[index];
            await bc.addBlock(block);
            bc.setHead(block.hash);
        }

        expect(() => bc.getBlock(blocks[0].hash)).to.throw(ApplicationError);
    });

    it("does not forget above head block", async () => {
        const blocks = generateBlocks(maxDepth + 2, 0, "main"); // head is depth 0, so first pruned is maxDepth + 2
        for (let index = 0; index < blocks.length; index++) {
            const block = blocks[index];
            await bc.addBlock(block);
            if (index === 0) bc.setHead(block.hash);
        }

        expect(bc.getBlock(blocks[0].hash)).to.deep.eq(blocks[0]);
    });

    fnIt<BlockCache<any>>(
        b => b.ancestry,
        "iterates over all the ancestors",
        async () => {
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
        }
    );

    fnIt<BlockCache<any>>(
        b => b.findAncestor,
        "returns the nearest ancestor that satisfies the predicate",
        async () => {
            const blocks = generateBlocks(5, 0, "main");
            for (const block of blocks) {
                await bc.addBlock(block);
            }
            const headBlock = blocks[blocks.length - 1];

            const result = bc.findAncestor(headBlock.hash, block => block.hash == blocks[2].hash);
            expect(result).to.not.be.null;
            expect(blocks[2]).to.deep.include(result!);
        }
    );

    fnIt<BlockCache<any>>(
        b => b.findAncestor,
        "returns self if satisfies the predicate",
        async () => {
            const blocks = generateBlocks(5, 0, "main");
            for (const block of blocks) {
                await bc.addBlock(block);
            }
            const headBlock = blocks[blocks.length - 1];

            const result = bc.findAncestor(headBlock.hash, block => block.hash == headBlock.hash);
            expect(result).to.not.be.null;
            expect(headBlock).to.deep.include(result!);
        }
    );

    fnIt<BlockCache<any>>(
        b => b.findAncestor,
        "returns self if satisfies the predicate",
        async () => {
            const blocks = generateBlocks(5, 0, "main");
            for (const block of blocks) {
                await bc.addBlock(block);
            }
            const headBlock = blocks[blocks.length - 1];

            const result = bc.findAncestor(headBlock.hash, block => block.hash == "notExistingHash");
            expect(result).to.be.null;
        }
    );

    fnIt<BlockCache<any>>(
        b => b.findAncestor,
        "does not return at height less than minHeight",
        async () => {
            const blocks = generateBlocks(5, 0, "main");
            for (const block of blocks) {
                await bc.addBlock(block);
            }
            const headBlock = blocks[blocks.length - 1];

            // condition is true only for a block at height strictly below minHeight
            const result = bc.findAncestor(headBlock.hash, block => block.number === blocks[3].number, blocks[3].number + 1);
            expect(result).to.be.null;
        }
    );

    fnIt<BlockCache<any>>(
        b => b.findAncestor,
        "does return at height equal or more than minHeight",
        async () => {
            const blocks = generateBlocks(5, 0, "main");
            for (const block of blocks) {
                await bc.addBlock(block);
            }
            const headBlock = blocks[blocks.length - 1];

            // condition is true only for blocks at height exactly minHeight
            const result = bc.findAncestor(headBlock.hash, block => block.number === blocks[3].number, blocks[3].number);
            expect(result).to.not.be.null;
            expect(blocks[3]).to.deep.include(result!);
        }
    );

    fnIt<BlockCache<any>>(
        b => b.getOldestAncestorInCache,
        "returns the deepest ancestor",
        async () => {
            const blocks = generateBlocks(5, 0, "main");
            for (const block of blocks) {
                await bc.addBlock(block);
            }
            const headBlock = blocks[blocks.length - 1];

            const result = bc.getOldestAncestorInCache(headBlock.hash);
            expect(blocks[0]).to.deep.include(result);
        }
    );

    fnIt<BlockCache<any>>(
        b => b.getOldestAncestorInCache,
        "throws ArgumentError for a hash not in cache",
        async () => {
            const blocks = generateBlocks(5, 0, "main");
            for (const block of blocks) {
                await bc.addBlock(block);
            }
            expect(() => bc.getOldestAncestorInCache("notExistingHash")).to.throw(ArgumentError);
        }
    );

    fnIt<BlockCache<any>>(
        b => b.setHead,
        "correctly sets new head",
        async () => {
            const blocks = generateBlocks(1, 0, "main");

            await bc.addBlock(blocks[0]);
            bc.setHead(blocks[0].hash);
            expect(bc.head).to.deep.equal(blocks[0]);
        }
    );

    fnIt<BlockCache<any>>(
        b => b.setHead,
        "setHead throws for head not in cache",
        async () => {
            const blocks = generateBlocks(1, 0, "main");

            expect(() => bc.setHead(blocks[0].hash)).to.throw(ArgumentError);
        }
    );

    it("head throws if setHead never called", async () => {
        expect(() => bc.head).to.throw(ApplicationError);
    });
});
