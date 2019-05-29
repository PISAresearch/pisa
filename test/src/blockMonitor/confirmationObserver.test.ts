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
    a2: { number: 2, hash: "a2", parentHash: "a1", transactions: [txHash] },
    a3: { number: 3, hash: "a3", parentHash: "a2", transactions: [] },
    a4: { number: 4, hash: "a4", parentHash: "a3", transactions: [forkedTxHash] },
    a5: { number: 5, hash: "a5", parentHash: "a4", transactions: [] },
    a6: { number: 6, hash: "a6", parentHash: "a5", transactions: [] },
    a7: { number: 7, hash: "a7", parentHash: "a6", transactions: [] },
    // A fork
    b3: { number: 3, hash: "b3", parentHash: "a2", transactions: [] },
    b4: { number: 4, hash: "b4", parentHash: "b3", transactions: [] },
    b5: { number: 5, hash: "b5", parentHash: "b4", transactions: [] }
};

class PromiseSpy<T> {
    private mResolved = false;
    private mResolvedWith: T;
    private mRejected = false;
    private mRejectedWith: any;
    public get resolved() {
        return this.mResolved;
    }
    public get resolvedWith() {
        return this.mResolvedWith;
    }
    public get rejected() {
        return this.mRejected;
    }
    public get rejectedWith() {
        return this.mRejectedWith;
    }
    public get settled() {
        return this.mResolved || this.mRejected;
    }

    constructor(promise: Promise<T>) {
        promise
            .then(value => {
                this.mResolved = true;
                this.mResolvedWith = value;
            })
            .catch(reason => {
                this.mRejected = true;
                this.mRejectedWith = reason;
            });
    }
}

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

    it("waitForConfirmations resolves immediately if already got enough confirmations", async () => {
        await emitNewHead("a1");
        await emitNewHead("a2");
        await Promise.resolve(); // flush promises

        const p = new PromiseSpy(confirmationObserver.waitForConfirmations(txHash, 1));

        await Promise.resolve(); // flush promises

        expect(p.resolved).to.be.true;
    });

    it("waitForConfirmations resolves after the right amount of confirmations, but not before", async () => {
        const p = new PromiseSpy(confirmationObserver.waitForConfirmations(txHash, 4));
        await Promise.resolve(); // flush promises

        await emitNewHead("a1");
        await emitNewHead("a2"); // first confirmation
        await emitNewHead("a3");
        await emitNewHead("a4");
        await Promise.resolve(); // flush promises

        expect(p.settled, "Did not settle too early").to.be.false;

        await emitNewHead("a5"); // 4 confirmations
        await Promise.resolve(); // flush promises

        expect(p.resolved, "Resolved after enough confirmations").to.be.true;
    });

    it("waitForBlocks resolves after the right amount of blocks, but not before", async () => {
        await emitNewHead("a1");
        await Promise.resolve(); // flush promises

        const p = new PromiseSpy(confirmationObserver.waitForBlocks(4));

        await emitNewHead("a2");
        await emitNewHead("a3");
        await emitNewHead("a4");
        await Promise.resolve(); // flush promises

        expect(p.settled, "Did not settle too early").to.be.false;

        await emitNewHead("a5"); // 4 blocks mined
        await Promise.resolve(); // flush promises

        expect(p.resolved, "Resolved after enough confirmations").to.be.true;
    });

    it("waitForConfirmationsToGoToZero resolves when the transaction is forked away (but not before)", async () => {
        await emitNewHead("a1");
        await emitNewHead("a2");
        await emitNewHead("a3");
        await emitNewHead("a4"); // tx confirmed here
        await emitNewHead("a5");
        await Promise.resolve(); // flush promises

        const p = new PromiseSpy(confirmationObserver.waitForConfirmationsToGoToZero(forkedTxHash));
        await Promise.resolve(); //flush promises

        expect(p.settled, "Did not settle too early").to.be.false;

        await emitNewHead("b5"); // A re-org happens with common ancenstor "a3"; transaction is now unconfirmed
        await Promise.resolve(); // flush promises

        expect(p.resolved, "Resolved after").to.be.true;
    });

    it("waitForFirstConfirmationOrBlockThreshold resolves when the transaction is mined", async () => {
        const p = new PromiseSpy(confirmationObserver.waitForFirstConfirmationOrBlockThreshold(txHash, 4));

        await emitNewHead("a1");
        await Promise.resolve(); // flush promises

        expect(p.settled, "Did not settle too early").to.be.false;

        await emitNewHead("a2"); // first confirmation
        await Promise.resolve(); // flush promises

        expect(p.resolved, "Resolved after the first confirmation").to.be.true;
    });

    it("waitForFirstConfirmationOrBlockThreshold rejects with BlockThresholdReached if the transaction is not mined", async () => {
        const unluckyTxHash = "0x13131313"; // transaction hash that will never be in a block

        await emitNewHead("a1");
        await Promise.resolve(); // flush promises

        const p = new PromiseSpy(confirmationObserver.waitForFirstConfirmationOrBlockThreshold(unluckyTxHash, 5));

        await emitNewHead("a2");
        await emitNewHead("a3");
        await emitNewHead("a4");
        await emitNewHead("a5");
        await emitNewHead("a6");

        expect(p.settled, "Did not settle early").to.be.false;

        await emitNewHead("a7");

        expect(p.rejectedWith, "Rejected with BlockThresholdReachedError after").to.be.instanceOf(
            BlockThresholdReachedError
        );
    });

    it("waitForConfirmationsOrReorg resolves after the right amount of confirmations, but not before", async () => {
        await emitNewHead("a1");
        await emitNewHead("a2"); // first confirmation
        await Promise.resolve(); // flush promises

        const p = new PromiseSpy(confirmationObserver.waitForConfirmationsOrReorg(txHash, 4));

        await emitNewHead("a3");
        await emitNewHead("a4");
        await Promise.resolve(); // flush promises

        expect(p.settled, "Did not settle too early").to.be.false;

        await emitNewHead("a5"); // 4 confirmations
        await Promise.resolve(); // flush promises

        expect(p.resolved, "Resolved after enough confirmations").to.be.true;
    });

    it("waitForConfirmationsOrReorg rejects with ReorgError if the transaction is not found later on", async () => {
        await emitNewHead("a1");
        await emitNewHead("a2");
        await emitNewHead("a3");
        await emitNewHead("a4"); // tx first confirmed here
        await emitNewHead("a5");
        await Promise.resolve(); // flush promises

        const p = new PromiseSpy(confirmationObserver.waitForConfirmationsOrReorg(forkedTxHash, 5));

        await emitNewHead("b5"); // A re-org happens with common ancenstor "a3"; transaction is now unconfirmed

        await Promise.resolve(); // flush promises

        expect(p.rejectedWith, "Rejected with ReorgError after").to.be.instanceOf(ReorgError);
    });
});
