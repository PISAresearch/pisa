import "mocha";
import { expect } from "chai";
import { BlockCache, IBlockStub } from "../../../src/blockMonitor";
import { ethers } from "ethers";

function generateBlocks(nBlocks: number, initialHeight: number, chain: string): ethers.providers.Block[] {
    const result: ethers.providers.Block[] = [];
    for (let height = initialHeight; height < initialHeight + nBlocks; height++) {
        const transactions: string[] = [];
        for (let i = 0; i < 5; i++) {
            transactions.push(`${chain}-block${height}tx${i + 1}`);
        }

        const block = {
            number: height,
            hash: `hash${height}`,
            parentHash: `hash${height - 1}`,
            transactions
        };

        result.push(block as ethers.providers.Block);
    }
    return result;
}

describe("BlockCache", () => {
    const maxDepth = 10;

    it("records a block that was just added", () => {
        const bf = new BlockCache(maxDepth);
        const blocks = generateBlocks(1, 0, "main");

        bf.addBlock(blocks[0]);
        expect(blocks[0]).to.deep.include(bf.getBlockStub(blocks[0].hash)!);
    });

    it("records blocks until maximum depth", () => {
        const bf = new BlockCache(maxDepth);
        const blocks = generateBlocks(maxDepth, 0, "main");

        for (let block of blocks) {
            bf.addBlock(block);
        }
        expect(blocks[0]).to.deep.include(bf.getBlockStub(blocks[0].hash)!);
    });

    it("forgets blocks past the maximum depth", () => {
        const bf = new BlockCache(maxDepth);
        const blocks = generateBlocks(maxDepth + 2, 0, "main"); // head is depth 0, so first pruned is maxDepth + 2

        for (let block of blocks) {
            bf.addBlock(block);
        }

        expect(bf.getBlockStub(blocks[0].hash)).to.equal(null);
    });

    it("getConfirmations correctly computes the number of confirmations for a transaction", () => {
        const bf = new BlockCache(maxDepth);
        const blocks = generateBlocks(7, 0, "main"); // must be less blocks than maxDepth

        for (let block of blocks) {
            bf.addBlock(block);
        }
        const headBlock = blocks[blocks.length - 1];
        expect(bf.getConfirmations(headBlock.hash, blocks[0].transactions[0])).to.equal(blocks.length);
    });
});
