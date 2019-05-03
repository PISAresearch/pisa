import "mocha";
import { BlockStubChain } from "../../../src/blockMonitor";
import { expect } from "chai";

describe("BlockStubChain", () => {
    const heights = [1, 2, 3, 4];
    const hashes = ["hash1", "hash2", "hash3", "hash4"];
    let genesis: BlockStubChain;
    let secondBlock: BlockStubChain;
    let thirdBlock: BlockStubChain;
    let fourthBlock: BlockStubChain;

    beforeEach(() => {
        genesis = BlockStubChain.genesis(heights[0], hashes[0]);
        secondBlock = genesis.extend(heights[1], hashes[1]);
        thirdBlock = secondBlock.extend(heights[2], hashes[2]);
        fourthBlock = thirdBlock.extend(heights[3], hashes[3]);
    });

    it("genesis creates block", () => {
        const block = BlockStubChain.genesis(heights[0], hashes[0]);
        expect(block.height).to.equal(heights[0]);
        expect(block.hash).to.equal(hashes[0]);
        expect(block.parent).to.equal(null);
    });

    it("extend creates block with parent", () => {
        const secondBlock = genesis.extend(heights[1], hashes[1]);
        expect(secondBlock.height).to.equal(heights[1]);
        expect(secondBlock.hash).to.equal(hashes[1]);
        expect(secondBlock.parent).to.equal(genesis);
    });

    it("extend correctly chains parents", () => {
        expect(fourthBlock.parent.parent.parent).to.equal(genesis);
    });

    it("extend twice creates block with two parents", () => {
        const thirdBlock = secondBlock.extend(heights[2], hashes[2]);
        expect(thirdBlock.height).to.equal(heights[2]);
        expect(thirdBlock.hash).to.equal(hashes[2]);
        expect(thirdBlock.parent).to.equal(secondBlock);
    });

    it("extend cannot from height !== parent.height + 1", () => {
        expect(() => genesis.extend(heights[2], hashes[2])).to.throw();
    });

    it("extend many creates one extra block", () => {
        const extendedChain = genesis.extendMany([secondBlock.asBlockStub()]);
        expect(extendedChain.height).to.equal(heights[1]);
        expect(extendedChain.hash).to.equal(hashes[1]);
        expect(extendedChain.parent).to.equal(genesis);
    });

    it("extend many creates many extra blocks", () => {
        const extendedChain = genesis.extendMany([secondBlock.asBlockStub(), thirdBlock.asBlockStub()]);
        expect(extendedChain.height).to.equal(heights[2]);
        expect(extendedChain.hash).to.equal(hashes[2]);
        expect(extendedChain.parent.hash).to.equal(hashes[1]);
    });

    it("extend many does not extend a gap", () => {
        expect(() => genesis.extendMany([thirdBlock.asBlockStub()])).to.throw();
    });

    it("extend many does not extend a different chain", () => {
        expect(() =>
            genesis.extendMany([
                {
                    hash: "newHash",
                    number: 2,
                    parentHash: "unknownHash"
                }
            ])
        ).to.throw();
    });

    it("ancestorWithHash finds hash", () => {
        expect(fourthBlock.blockInChainWithHash(genesis.hash)).to.equal(genesis);
        expect(fourthBlock.blockInChainWithHash(secondBlock.hash)).to.equal(secondBlock);
        expect(fourthBlock.blockInChainWithHash(thirdBlock.hash)).to.equal(thirdBlock);
    });

    it("ancestorWithHash doesn't find missing hash", () => {
        expect(fourthBlock.blockInChainWithHash("unknown hash")).to.equal(null);
    });

    it("ancestorWithHeight finds height", () => {
        expect(fourthBlock.blockInChainWithHeight(genesis.height)).to.equal(genesis);
        expect(fourthBlock.blockInChainWithHeight(secondBlock.height)).to.equal(secondBlock);
        expect(fourthBlock.blockInChainWithHeight(thirdBlock.height)).to.equal(thirdBlock);
    });

    it("ancestorWithHeight doesnt find missing height", () => {
        expect(fourthBlock.blockInChainWithHeight(5)).to.equal(null);
    });

    it("prune only prunes below height, not above", () => {
        fourthBlock.prune(secondBlock.height);
        expect(secondBlock.parent).to.equal(null);
        expect(thirdBlock.parent).to.equal(secondBlock);
        expect(fourthBlock.parent).to.equal(thirdBlock);
    });

    it("prune twice is the same as prune", () => {
        fourthBlock.prune(secondBlock.height);
        fourthBlock.prune(secondBlock.height);
        expect(secondBlock.parent).to.equal(null);
        expect(thirdBlock.parent).to.equal(secondBlock);
        expect(fourthBlock.parent).to.equal(thirdBlock);
    });

    it("prune does nothing when called for too low number", () => {
        fourthBlock.prune(0);
        expect(secondBlock.parent).to.equal(genesis);
        expect(thirdBlock.parent).to.equal(secondBlock);
        expect(fourthBlock.parent).to.equal(thirdBlock);
    });

    it("prune can prune to current height", () => {
        fourthBlock.prune(fourthBlock.height);
        expect(fourthBlock.parent).to.equal(null);
    });

    it("prune cannot prune above current height", () => {
        expect(() => fourthBlock.prune(fourthBlock.height + 1)).to.throw();
    });

    it("prune below min does nothing to current block", () => {
        fourthBlock.prune(fourthBlock.height);
        expect(fourthBlock.parent).to.equal(null);

        fourthBlock.prune(thirdBlock.height);
        expect(fourthBlock.parent).to.equal(null);
    });

    it("asBlockStub returns core components", () => {
        const blockData = fourthBlock.asBlockStub();
        expect(blockData.hash).to.equal(fourthBlock.hash);
        expect(blockData.number).to.equal(fourthBlock.height);
        expect(blockData.parentHash).to.equal(fourthBlock.parent.hash);
    });

    it("asBlockStub returns null parent for genesis", () => {
        const blockData = genesis.asBlockStub();
        expect(blockData.hash).to.equal(genesis.hash);
        expect(blockData.number).to.equal(genesis.height);
        expect(blockData.parentHash).to.equal(null);
    });
});
