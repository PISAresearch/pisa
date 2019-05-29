import "mocha";
import { BlockStubChain } from "../../../src/blockMonitor";
import { expect } from "chai";

describe("BlockStubChain", () => {
    const blockStubs = [
        {
            number: 1,
            hash: "hash1",
            parentHash: "hash0"
        },
        {
            number: 2,
            hash: "hash2",
            parentHash: "hash1"
        },
        {
            number: 3,
            hash: "hash3",
            parentHash: "hash2"
        },
        {
            number: 4,
            hash: "hash4",
            parentHash: "hash3"
        }
    ];

    let genesis: BlockStubChain;
    let secondBlock: BlockStubChain;
    let thirdBlock: BlockStubChain;
    let fourthBlock: BlockStubChain;

    beforeEach(() => {
        genesis = BlockStubChain.newRoot(blockStubs[0]);
        secondBlock = genesis.extend(blockStubs[1]);
        thirdBlock = secondBlock.extend(blockStubs[2]);
        fourthBlock = thirdBlock.extend(blockStubs[3]);
    });

    it("new root creates block", () => {
        const block = BlockStubChain.newRoot(blockStubs[0]);
        expect(block.height).to.equal(blockStubs[0].number);
        expect(block.hash).to.equal(blockStubs[0].hash);
        expect(block.parentHash).to.equal(blockStubs[0].parentHash);
        expect(block.parentChain).to.equal(null);
    });

    it("extend creates block with parent", () => {
        const secondBlock = genesis.extend(blockStubs[1]);
        expect(secondBlock.height).to.equal(blockStubs[1].number);
        expect(secondBlock.hash).to.equal(blockStubs[1].hash);
        expect(secondBlock.parentHash).to.equal(blockStubs[1].parentHash);
        expect(secondBlock.parentChain).to.equal(genesis);
    });

    it("extend correctly chains parents", () => {
        expect(fourthBlock.parentChain!.parentChain!.parentChain).to.equal(genesis);
    });

    it("extend twice creates block with two parents", () => {
        const thirdBlock = secondBlock.extend(blockStubs[2]);
        expect(thirdBlock.height).to.equal(blockStubs[2].number);
        expect(thirdBlock.hash).to.equal(blockStubs[2].hash);
        expect(thirdBlock.parentHash).to.equal(blockStubs[2].parentHash);
        expect(thirdBlock.parentChain).to.equal(secondBlock);
    });

    it("extend cannot from height !== parent.height + 1", () => {
        expect(() => genesis.extend(blockStubs[2])).to.throw();
    });

    it("extend many creates one extra block", () => {
        const extendedChain = genesis.extendMany([secondBlock.asBlockStub()]);
        expect(extendedChain.height).to.equal(blockStubs[1].number);
        expect(extendedChain.hash).to.equal(blockStubs[1].hash);
        expect(extendedChain.parentChain).to.equal(genesis);
    });

    it("extend many creates many extra blocks", () => {
        const extendedChain = genesis.extendMany([secondBlock.asBlockStub(), thirdBlock.asBlockStub()]);
        expect(extendedChain.height).to.equal(blockStubs[2].number);
        expect(extendedChain.hash).to.equal(blockStubs[2].hash);
        expect(extendedChain.parentHash).to.equal(blockStubs[2].parentHash);
        expect(extendedChain.parentChain!.hash).to.equal(blockStubs[1].hash);
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

    it("blockInChainWithHash finds hash", () => {
        expect(fourthBlock.ancestorWithHash(genesis.hash)).to.equal(genesis);
        expect(fourthBlock.ancestorWithHash(secondBlock.hash)).to.equal(secondBlock);
        expect(fourthBlock.ancestorWithHash(thirdBlock.hash)).to.equal(thirdBlock);
    });

    it("blockInChainWithHash doesn't find missing hash", () => {
        expect(fourthBlock.ancestorWithHash("unknown hash")).to.equal(null);
    });

    it("blockInChainWithHeight finds height", () => {
        expect(fourthBlock.ancestorWithHeight(genesis.height)).to.equal(genesis);
        expect(fourthBlock.ancestorWithHeight(secondBlock.height)).to.equal(secondBlock);
        expect(fourthBlock.ancestorWithHeight(thirdBlock.height)).to.equal(thirdBlock);
    });

    it("blockInChainWithHeight doesnt find missing height", () => {
        expect(fourthBlock.ancestorWithHeight(5)).to.equal(null);
    });

    it("prune only prunes below height, not above", () => {
        fourthBlock.prune(secondBlock.height);
        expect(secondBlock.parentChain).to.equal(null);
        expect(thirdBlock.parentChain).to.equal(secondBlock);
        expect(fourthBlock.parentChain).to.equal(thirdBlock);
    });

    it("prune twice is the same as prune", () => {
        fourthBlock.prune(secondBlock.height);
        fourthBlock.prune(secondBlock.height);
        expect(secondBlock.parentChain).to.equal(null);
        expect(thirdBlock.parentChain).to.equal(secondBlock);
        expect(fourthBlock.parentChain).to.equal(thirdBlock);
    });

    it("prune does nothing when called for too low number", () => {
        fourthBlock.prune(0);
        expect(secondBlock.parentChain).to.equal(genesis);
        expect(thirdBlock.parentChain).to.equal(secondBlock);
        expect(fourthBlock.parentChain).to.equal(thirdBlock);
    });

    it("prune can prune to current height", () => {
        fourthBlock.prune(fourthBlock.height);
        expect(fourthBlock.parentChain).to.equal(null);
    });

    it("prune cannot prune above current height", () => {
        expect(() => fourthBlock.prune(fourthBlock.height + 1)).to.throw();
    });

    it("prune below min does nothing to current block", () => {
        fourthBlock.prune(fourthBlock.height);
        expect(fourthBlock.parentChain).to.equal(null);

        fourthBlock.prune(thirdBlock.height);
        expect(fourthBlock.parentChain).to.equal(null);
    });

    it("asBlockStub returns core components", () => {
        const blockData = fourthBlock.asBlockStub();
        expect(blockData.hash).to.equal(fourthBlock.hash);
        expect(blockData.number).to.equal(fourthBlock.height);
        expect(blockData.parentHash).to.equal(fourthBlock.parentChain!.hash);
    });
});
