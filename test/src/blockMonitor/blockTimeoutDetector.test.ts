import "mocha";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import lolex from "lolex";
import { BlockTimeoutDetector, BlockProcessor } from "../../../src/blockMonitor";
import { EventEmitter } from "events";

chai.use(chaiAsPromised);
const expect = chai.expect;

describe("BlockTimeoutDetector", () => {
    const timeout = 120 * 1000;
    let mockBlockProcessor: BlockProcessor;
    let clock: lolex.InstalledClock;
    let blockTimeoutDetector: BlockTimeoutDetector;

    beforeEach(async () => {
        clock = lolex.install();

        const eventEmitter = new EventEmitter();
        mockBlockProcessor = eventEmitter as BlockProcessor; // we just need the mock to emit events

        blockTimeoutDetector = new BlockTimeoutDetector(mockBlockProcessor, timeout);
        await blockTimeoutDetector.start();
    });

    afterEach(async () => {
        await blockTimeoutDetector.stop();
        clock.uninstall();
    });

    it("does not emit a timeout event prematurely", async () => {
        let timeoutEmitted = false;
        blockTimeoutDetector.on(BlockTimeoutDetector.BLOCK_TIMEOUT_EVENT, () => {
            timeoutEmitted = true;
        });

        clock.tick(timeout - 1); // wait less than the timeout

        expect(timeoutEmitted).to.be.false;
    });

    it("emits a timeout event after the timeout", async () => {
        let timeoutEmitted = false;
        blockTimeoutDetector.on(BlockTimeoutDetector.BLOCK_TIMEOUT_EVENT, () => {
            timeoutEmitted = true;
        });

        clock.tick(timeout + 1); // wait more than the timeout
        await Promise.resolve();

        expect(timeoutEmitted).to.be.true;
    });

    it("resets its timer when receiving a new block", async () => {
        let timeoutEmitted = false;
        blockTimeoutDetector.on(BlockTimeoutDetector.BLOCK_TIMEOUT_EVENT, () => {
            timeoutEmitted = true;
        });

        clock.tick(timeout - 1); // wait less than the timeout

        // produce a block
        mockBlockProcessor.emit(BlockProcessor.NEW_HEAD_EVENT, 42, "0x42424242");

        clock.tick(timeout - 2); // wait less than the timeout

        expect(timeoutEmitted, "did not emit timeout too early").to.be.false;

        clock.tick(2); // now we are past the timeout

        expect(timeoutEmitted, "emitted timeout at the right time").to.be.true;
    });
});
