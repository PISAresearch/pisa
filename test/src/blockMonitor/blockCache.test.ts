import "mocha";
import { expect } from "chai";
import { BlockCache, getConfirmations } from "../../../src/blockMonitor";
import { ArgumentError, IBlockStub, TransactionHashes, ApplicationError } from "../../../src/dataEntities";

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
            parentHash:
                rootParentHash != null && height === initialHeight ? rootParentHash : `hash-${chain}-${height - 1}`,
            transactionHashes: transactions
        };

        result.push(block as (IBlockStub & TransactionHashes));
    }
    return result;
}

describe("BlockCache", () => {
    const maxDepth = 10;

    it("records a block that was just added", () => {
        const bc = new BlockCache(maxDepth);
        const blocks = generateBlocks(1, 0, "main");

        bc.addBlock(blocks[0]);
        expect(blocks[0]).to.deep.include(bc.getBlock(blocks[0].hash));
    });

    it("addBlock adds blocks that are complete and returns true", () => {
        const bc = new BlockCache(maxDepth);
        const blocks = generateBlocks(10, 5, "main");
        expect(bc.addBlock(blocks[0])).to.be.true;
        expect(bc.addBlock(blocks[1])).to.be.true;
        expect(bc.addBlock(blocks[2])).to.be.true;
    });
    it("addBlock adds pending blocks and returns false", () => {
        const bc = new BlockCache(maxDepth);
        const blocks = generateBlocks(10, 5, "main");
        bc.addBlock(blocks[0]);
        expect(bc.addBlock(blocks[3])).to.be.false;
        expect(bc.addBlock(blocks[2])).to.be.false;
    });

    it("hasBlock returns true for an existing complete block", () => {
        const bc = new BlockCache(maxDepth);
        const blocks = generateBlocks(10, 5, "main");
        bc.addBlock(blocks[0]);
        bc.addBlock(blocks[1]);
        expect(bc.hasBlock(blocks[1].hash)).to.be.true;
    });
    it("hasBlock returns false for a non-existing block", () => {
        const bc = new BlockCache(maxDepth);
        const blocks = generateBlocks(10, 5, "main");
        bc.addBlock(blocks[0]);
        bc.addBlock(blocks[1]);
        expect(bc.hasBlock("someNonExistingHash")).to.be.false;
    });
    it("hasBlock( , false) returns false for a pending block", () => {
        const bc = new BlockCache(maxDepth);
        const blocks = generateBlocks(10, 5, "main");
        bc.addBlock(blocks[0]);
        bc.addBlock(blocks[1]);
        bc.addBlock(blocks[3]);
        expect(bc.hasBlock(blocks[3].hash, false)).to.be.false;
    });
    it("hasBlock( , true) returns true for a pending block", () => {
        const bc = new BlockCache(maxDepth);
        const blocks = generateBlocks(10, 5, "main");
        bc.addBlock(blocks[0]);
        bc.addBlock(blocks[1]);
        bc.addBlock(blocks[3]);
        expect(bc.hasBlock(blocks[3].hash, true)).to.be.true;
    });

    it("addBlock makes sure that previously pending block become complete if appropriate", () => {
        const bc = new BlockCache(maxDepth);
        const blocks = generateBlocks(10, 5, "main");
        bc.addBlock(blocks[0]);
        bc.addBlock(blocks[3]);
        bc.addBlock(blocks[2]);
        expect(bc.addBlock(blocks[1])).to.be.true;
        expect(bc.maxHeight).to.equal(blocks[3].number);
        expect(bc.hasBlock(blocks[3].hash)).to.be.true;
    });

    it("maxHeight does not change for pending blocks", () => {
        const bc = new BlockCache(maxDepth);
        const blocks = generateBlocks(10, 5, "main");
        bc.addBlock(blocks[0]);
        bc.addBlock(blocks[3]);
        expect(bc.maxHeight).to.equal(blocks[0].number);
    });

    it("getBlock returns a complete block", () => {
        const bc = new BlockCache(maxDepth);
        const blocks = generateBlocks(10, 5, "main");
        bc.addBlock(blocks[0]);
        bc.addBlock(blocks[1]);
        bc.addBlock(blocks[3]);
        expect(bc.getBlock(blocks[1].hash)).to.deep.equal(blocks[1]);
    });
    it("getBlock returns a pending block", () => {
        const bc = new BlockCache(maxDepth);
        const blocks = generateBlocks(10, 5, "main");
        bc.addBlock(blocks[0]);
        bc.addBlock(blocks[1]);
        bc.addBlock(blocks[3]);
        expect(bc.getBlock(blocks[3].hash)).to.deep.equal(blocks[3]);
    });
    it("getBlock throws ApplicationError for an unknown block", () => {
        const bc = new BlockCache(maxDepth);
        const blocks = generateBlocks(10, 5, "main");
        bc.addBlock(blocks[0]);
        bc.addBlock(blocks[1]);
        bc.addBlock(blocks[3]);
        expect(() => bc.getBlock("someNonExistingHash")).to.throw(ApplicationError);
    });

    it("minHeight is equal to the initial block height if less then maxDepth blocks are added", () => {
        const bc = new BlockCache(maxDepth);
        const initialHeight = 3;
        const blocks = generateBlocks(maxDepth - 1, initialHeight, "main");
        blocks.forEach(block => bc.addBlock(block));

        expect(bc.minHeight).to.equal(initialHeight);
    });

    it("minHeight is equal to the height of the highest added block minus maxDepth if more than maxDepth blocks are added", () => {
        const bc = new BlockCache(maxDepth);
        const initialHeight = 3;
        const blocksAdded = 2 * maxDepth;
        const lastBlockAdded = initialHeight + blocksAdded - 1;
        const blocks = generateBlocks(blocksAdded, initialHeight, "main");
        blocks.forEach(block => bc.addBlock(block));

        expect(bc.minHeight).to.equal(lastBlockAdded - maxDepth);
    });

    it("maxHeight is equal to the height of the highest added block", () => {
        const bc = new BlockCache(maxDepth);
        const initialHeight = 3;
        const blocksAdded = 2 * maxDepth;
        const lastBlockAdded = initialHeight + blocksAdded - 1;

        // Add some blocks
        for (const block of generateBlocks(blocksAdded, initialHeight, "main")) {
            bc.addBlock(block);
        }
        // Add a shorter separate chain
        for (const block of generateBlocks(blocksAdded - 1, initialHeight, "forkedchain")) {
            bc.addBlock(block);
        }

        expect(bc.maxHeight).to.equal(lastBlockAdded);
    });

    it("canAddBlock returns true for blocks whose height is equal than the initial height", () => {
        const bc = new BlockCache(maxDepth);

        const blocks = generateBlocks(10, 5, "main");
        const otherBlocks = generateBlocks(10, 5, "other");

        bc.addBlock(blocks[3]);

        expect(bc.canAddBlock(blocks[3])).to.be.true;
        expect(bc.canAddBlock(otherBlocks[3])).to.be.true;
    });

    it("canAddBlock returns false for blocks whose height is lower than the initial height", () => {
        const bc = new BlockCache(maxDepth);

        const blocks = generateBlocks(10, 5, "main");
        const otherBlocks = generateBlocks(10, 5, "other");

        bc.addBlock(blocks[3]);

        expect(bc.canAddBlock(blocks[2])).to.be.false;
        expect(bc.canAddBlock(otherBlocks[2])).to.be.false;
    });

    it("canAddBlock returns true for blocks whose height is equal than the maximum depth", () => {
        const bc = new BlockCache(maxDepth);
        const initialHeight = 3;
        const blocksAdded = maxDepth + 1;
        const blocks = generateBlocks(blocksAdded, initialHeight, "main");
        blocks.forEach(block => bc.addBlock(block));

        const otherBlocks = generateBlocks(2, initialHeight - 1, "main");

        expect(bc.canAddBlock(otherBlocks[1])).to.be.true;
    });

    it("canAddBlock returns false for blocks whose height is lower than the maximum depth", () => {
        const bc = new BlockCache(maxDepth);
        const initialHeight = 3;
        const blocksAdded = maxDepth + 1;
        const blocks = generateBlocks(blocksAdded, initialHeight, "main");
        blocks.forEach(block => bc.addBlock(block));

        const otherBlocks = generateBlocks(2, initialHeight - 1, "main");

        expect(bc.canAddBlock(otherBlocks[0])).to.be.false;
    });

    it("canAddBlock returns true for a block whose parent is in the BlockCache", () => {
        const bc = new BlockCache(maxDepth);
        const blocks = generateBlocks(10, 7, "main");

        bc.addBlock(blocks[5]);

        expect(bc.canAddBlock(blocks[6])).to.be.true;
    });

    it("canAddBlock returns false for a block above minHeight whose parent is not in the BlockCache", () => {
        const bc = new BlockCache(maxDepth);
        const blocks = generateBlocks(10, 7, "main");

        bc.addBlock(blocks[0]);
        bc.addBlock(blocks[1]);
        bc.addBlock(blocks[2]);

        expect(bc.canAddBlock(blocks[4])).to.be.false;
    });

    it("records blocks until maximum depth", () => {
        const bc = new BlockCache(maxDepth);
        const blocks = generateBlocks(maxDepth, 0, "main");
        blocks.forEach(block => bc.addBlock(block));

        expect(blocks[0]).to.deep.include(bc.getBlock(blocks[0].hash));
    });

    it("forgets blocks past the maximum depth", () => {
        const bc = new BlockCache(maxDepth);
        const blocks = generateBlocks(maxDepth + 2, 0, "main"); // head is depth 0, so first pruned is maxDepth + 2
        blocks.forEach(block => bc.addBlock(block));

        expect(() => bc.getBlock(blocks[0].hash)).to.throw(ApplicationError);
    });

    it("ancestry iterates over all the ancestors", () => {
        const bc = new BlockCache(maxDepth);
        const blocks = generateBlocks(10, 0, "main");
        blocks.forEach(block => bc.addBlock(block));
        const headBlock = blocks[blocks.length - 1];

        // Add some other blocks in a forked chain at height 3
        generateBlocks(5, 3, "fork", blocks[1].hash).forEach(block => bc.addBlock(block));

        const result = [...bc.ancestry(headBlock.hash)];
        result.reverse();

        expect(result).to.deep.equal(blocks);
    });

    it("findAncestor returns the nearest ancestor that satisfies the predicate", () => {
        const bc = new BlockCache(maxDepth);
        const blocks = generateBlocks(5, 0, "main");
        blocks.forEach(block => bc.addBlock(block));
        const headBlock = blocks[blocks.length - 1];

        const result = bc.findAncestor(headBlock.hash, block => block.hash == blocks[2].hash);
        expect(result).to.not.be.null;
        expect(blocks[2]).to.deep.include(result!);
    });

    it("findAncestor returns self if satisfies the predicate", () => {
        const bc = new BlockCache(maxDepth);
        const blocks = generateBlocks(5, 0, "main");
        blocks.forEach(block => bc.addBlock(block));
        const headBlock = blocks[blocks.length - 1];

        const result = bc.findAncestor(headBlock.hash, block => block.hash == headBlock.hash);
        expect(result).to.not.be.null;
        expect(headBlock).to.deep.include(result!);
    });

    it("findAncestor returns self if satisfies the predicate", () => {
        const bc = new BlockCache(maxDepth);
        const blocks = generateBlocks(5, 0, "main");
        blocks.forEach(block => bc.addBlock(block));
        const headBlock = blocks[blocks.length - 1];

        const result = bc.findAncestor(headBlock.hash, block => block.hash == "notExistingHash");
        expect(result).to.be.null;
    });

    it("getOldestAncestorInCache returns the deepest ancestor", () => {
        const bc = new BlockCache(maxDepth);
        const blocks = generateBlocks(5, 0, "main");
        blocks.forEach(block => bc.addBlock(block));
        const headBlock = blocks[blocks.length - 1];

        const result = bc.getOldestAncestorInCache(headBlock.hash);
        expect(blocks[0]).to.deep.include(result);
    });

    it("getOldestAncestorInCache throws ArgumentError for a hash not in cache", () => {
        const bc = new BlockCache(maxDepth);
        const blocks = generateBlocks(5, 0, "main");
        blocks.forEach(block => bc.addBlock(block));

        expect(() => bc.getOldestAncestorInCache("notExistingHash")).to.throw(ArgumentError);
    });

    it("setHead correctly sets new head", () => {
        const bc = new BlockCache(maxDepth);
        const blocks = generateBlocks(1, 0, "main");

        bc.addBlock(blocks[0]);
        bc.setHead(blocks[0].hash);
        expect(bc.head).to.deep.equal(blocks[0]);
    });

    it("setHead throws for head not in cache", () => {
        const bc = new BlockCache(maxDepth);
        const blocks = generateBlocks(1, 0, "main");

        expect(() => bc.setHead(blocks[0].hash)).to.throw(ArgumentError);
    });

    it("head throws if setHead never called", () => {
        const bc = new BlockCache(maxDepth);
        expect(() => bc.head).to.throw(ApplicationError);
    });
});

describe("getConfirmations", () => {
    const maxDepth = 100;
    it("correctly computes the number of confirmations for a transaction", () => {
        const bc = new BlockCache<IBlockStub & TransactionHashes>(maxDepth);
        const blocks = generateBlocks(7, 0, "main"); // must be less blocks than maxDepth
        blocks.forEach(block => bc.addBlock(block));

        const headBlock = blocks[blocks.length - 1];
        expect(getConfirmations(bc, headBlock.hash, blocks[0].transactionHashes[0])).to.equal(blocks.length);
        expect(getConfirmations(bc, headBlock.hash, blocks[1].transactionHashes[0])).to.equal(blocks.length - 1);
    });

    it("correctly returns 0 confirmations if transaction is not known", () => {
        const bc = new BlockCache<IBlockStub & TransactionHashes>(maxDepth);
        const blocks = generateBlocks(128, 0, "main");
        blocks.forEach(block => bc.addBlock(block));

        const headBlock = blocks[blocks.length - 1];
        expect(getConfirmations(bc, headBlock.hash, "nonExistingTxHash")).to.equal(0);
    });

    it("throws ArgumentError if no block with the given hash is in the BlockCache", () => {
        const bc = new BlockCache<IBlockStub & TransactionHashes>(maxDepth);
        const blocks = generateBlocks(128, 0, "main");
        blocks.forEach(block => bc.addBlock(block));

        const headBlock = blocks[blocks.length - 1];
        expect(() => getConfirmations(bc, "nonExistingBlockHash", headBlock.transactionHashes[0])).to.throw(
            ApplicationError
        );
    });
});
