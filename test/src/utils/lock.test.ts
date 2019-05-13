import "mocha";
import { expect } from "chai";
import { Lock, LockManager, LockUtil } from "../../../src/utils/lock";
import { wait } from "../../../src/utils";
import { ApplicationError } from "../../../src/dataEntities";

describe("Lock", () => {
    it("updates 'locked' correctly", async () => {
        const lock = new Lock();

        await lock.acquire();

        expect(lock.locked, "set locked to true after acquire").to.be.true;

        lock.release();

        expect(lock.locked, "set locked to false after release").to.be.false;
    });

    it("gives the lock to the waiters in the right order", async () => {
        const lock = new Lock();

        const callOrder: number[] = [];
        const p1 = lock.acquire().then(async () => {
            callOrder.push(1);
            await wait(30); // make sure to take some time before releasing
            lock.release();
        });

        const p2 = lock.acquire().then(() => {
            callOrder.push(2);
            lock.release();
        });

        const p3 = lock.acquire().then(() => {
            callOrder.push(3);
            lock.release();
        });

        await Promise.all([p1, p2, p3]);

        expect(callOrder).to.deep.equal([1, 2, 3]);
    });

    it("throws if released when not locked", () => {
        const lock = new Lock();
        expect(() => lock.release()).to.throw(ApplicationError);
    });
});

describe("LockUtil", () => {
    it("returns the value returned by the passed function", async () => {
        const lockUtil = new LockUtil();
        const func = async () => 42;
        const res = await lockUtil.withLock("testId", func);

        expect(res).to.equal(42);
    });

    it("throws the same error if the passed function throws", () => {
        const lockUtil = new LockUtil();
        const t = new Error("Test error");
        const func = () => {
            throw t;
        };
        expect(lockUtil.withLock("testId", func)).to.be.rejectedWith(t);
    });
});
