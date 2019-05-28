import "mocha";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { ConfirmationObserver, BlockProcessor, BlockCache, IBlockStub } from "../../../src/blockMonitor";
import { EventEmitter } from "events";
import { ethers } from "ethers";
import { ApplicationError, BlockThresholdReachedError, ReorgError } from "../../../src/dataEntities";

chai.use(chaiAsPromised);
const expect = chai.expect;

interface IBlockStubWithTransactions extends IBlockStub {
    transactions: string[];
}

const txHash = "0x12345678";
const forkedTxHash = "0xffffffff";

const blocksByHash: { [key: string]: IBlockStubWithTransactions } = {
    a1: { number: 1, hash: "a1", parentHash: "a0", transactions: [] },
    a2: { number: 2, hash: "a2", parentHash: "a1", transactions: ["0x12345678"] },
    a3: { number: 3, hash: "a3", parentHash: "a2", transactions: [] },
    a4: { number: 4, hash: "a4", parentHash: "a3", transactions: ["0xffffffff"] },
    a5: { number: 5, hash: "a5", parentHash: "a4", transactions: [] },
    a6: { number: 6, hash: "a6", parentHash: "a5", transactions: [] },
    a7: { number: 7, hash: "a7", parentHash: "a6", transactions: [] },
    // A fork
    b3: { number: 3, hash: "b3", parentHash: "a2", transactions: [] },
    b4: { number: 4, hash: "b4", parentHash: "b3", transactions: [] },
    b5: { number: 5, hash: "b5", parentHash: "b4", transactions: [] }
};

describe("ConfirmationObserver", () => {
    let blockCache: BlockCache;
    let mockBlockProcessor: BlockProcessor;

    let confirmationObserver: ConfirmationObserver;

    async function emitNewHead(hash: string): Promise<void> {
        if (!(hash in blocksByHash)) {
            throw new ApplicationError(`Hash ${hash} does not exist in blocksByHash`);
        }

        (mockBlockProcessor as any).head = blocksByHash[hash]; // set this block as head for the blockProcessor

        mockBlockProcessor.emit(BlockProcessor.NEW_HEAD_EVENT, blocksByHash[hash].number, hash); // emit new head event

        await Promise.resolve(); // Make sure events are processed
    }

    beforeEach(async () => {
        blockCache = new BlockCache(100);

        // we put all the blocks in the block cache, so the confirmationObserver finds them when needed
        for (const block of Object.values(blocksByHash)) {
            blockCache.addBlock(block as ethers.providers.Block);
        }

        const eventEmitter = new EventEmitter();
        mockBlockProcessor = eventEmitter as BlockProcessor; // we just need the mock to emit events

        Object.defineProperty(mockBlockProcessor, "head", {
            value: null,
            writable: true
        });

        confirmationObserver = new ConfirmationObserver(blockCache, mockBlockProcessor);
        await confirmationObserver.start();
    });

    afterEach(async () => {
        await confirmationObserver.stop();
    });

    it("waitForConfirmations(1, ...) resolves after one confirmation, but not before", async () => {
        let resolved = false;
        let threw: Error | null = null;

        confirmationObserver
            .waitForConfirmations(txHash, 1, null, false)
            .then(() => {
                resolved = true;
            })
            .catch((error: Error) => {
                threw = error;
            });

        await emitNewHead("a1");

        expect(resolved, "Did not resolve too early").to.be.false;
        expect(threw, "Did not throw early").to.be.null;

        await emitNewHead("a2");

        expect(resolved, "Resolved after the block").to.be.true;
        expect(threw, "Did not throw after").to.be.null;
    });

    it("waitForConfirmations resolves immediately if already confirmed enough", async () => {
        let resolved = false;
        let threw: Error | null = null;

        await emitNewHead("a1");
        await emitNewHead("a2");

        confirmationObserver
            .waitForConfirmations(txHash, 1, null, false)
            .then(() => {
                resolved = true;
            })
            .catch((error: Error) => {
                threw = error;
            });

        await Promise.resolve();

        expect(resolved).to.be.true;
        expect(threw, "Did not throw").to.be.null;
    });

    it("waitForConfirmations resolves after the right amount of confirmations, but not before", async () => {
        let resolved = false;
        let threw: Error | null = null;

        confirmationObserver
            .waitForConfirmations(txHash, 4, null, false)
            .then(() => {
                resolved = true;
            })
            .catch((error: Error) => {
                threw = error;
            });

        await emitNewHead("a1");
        await emitNewHead("a2"); // first confirmation
        await emitNewHead("a3");
        await emitNewHead("a4");

        expect(resolved, "Did not resolve too early").to.be.false;
        expect(threw, "Did not throw early").to.be.null;

        await emitNewHead("a5"); // 4 confirmations

        expect(resolved, "Resolved after enough confirmations").to.be.true;
        expect(threw, "Did not throw after").to.be.null;
    });

    it("waitForConfirmations rejects with BlockThresholdReached if the transaction is not mined", async () => {
        const unluckyTxHash = "0x13131313"; // transaction hash that will never be in a block

        let resolved = false;
        let threw: Error | null = null;

        await emitNewHead("a1");

        confirmationObserver
            .waitForConfirmations(unluckyTxHash, 1, 6, false)
            .then(() => {
                resolved = true;
            })
            .catch((error: Error) => {
                threw = error;
            });

        await emitNewHead("a2");
        await emitNewHead("a3");
        await emitNewHead("a4");
        await emitNewHead("a5");
        await emitNewHead("a6");

        expect(resolved, "Did not resolve early").to.be.false;
        expect(threw, "Did not throw early").to.be.null;

        await emitNewHead("a7");

        expect(resolved, "Did not resolve").to.be.false;
        expect(threw, "Threw BlockThresholdReachedError after").to.be.instanceOf(BlockThresholdReachedError);
    });

    it("waitForConfirmations rejects with ReorgError if the transaction is not found later on", async () => {
        let resolved = false;
        let threw: Error | null = null;

        await emitNewHead("a1");
        await emitNewHead("a2");
        await emitNewHead("a3");
        await emitNewHead("a4"); // tx first confirmed here
        await emitNewHead("a5");

        confirmationObserver
            .waitForConfirmations(forkedTxHash, 5, null, true)
            .then(() => {
                resolved = true;
            })
            .catch((error: Error) => {
                threw = error;
            });

        await emitNewHead("b5"); // A re-org happens with common ancenstor "a3"; transaction is now unconfirmed

        expect(resolved, "Did not resolve").to.be.false;
        expect(threw, "Threw ReorgError after").to.be.instanceOf(ReorgError);
    });
});
