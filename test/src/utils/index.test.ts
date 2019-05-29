import "mocha";
import { expect } from "chai";
import { EventEmitter } from "events";
import { waitForEvent, wait } from "../../../src/utils";

describe("waitForEvent", async () => {
    it("resolves when the event is fired (but not before)", async () => {
        const eventEmitter = new EventEmitter();
        const promise = waitForEvent(eventEmitter, "event");

        let resolved = false;
        promise.then(() => {
            resolved = true;
        });

        await wait(20);

        expect(resolved, "did not resolve prematurely").to.be.false;

        eventEmitter.emit("event");

        return promise;
    });

    it("does not resolve when a different event is emitted", async () => {
        const eventEmitter = new EventEmitter();
        const promise = waitForEvent(eventEmitter, "event");

        let resolved = false;
        promise.then(() => {
            resolved = true;
        });

        eventEmitter.emit("anotherEvent");

        await wait(20);

        expect(resolved).to.be.false;
    });
});
