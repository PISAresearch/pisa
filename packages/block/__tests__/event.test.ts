import "mocha";
import { expect } from "chai";
import { ApplicationError } from "@pisa-research/errors";
import { fnIt } from "@pisa-research/test-utils";
import { Event, BlockEvent, IBlockStub } from "../src";

describe("Event", async () => {
    const block: IBlockStub = {
        number: 42,
        hash: "0x4242",
        parentHash: "0x1111"
    };

    fnIt<Event<any>>(e => e.addListener, "adds a listener and receives the event with the correct parameter", async () => {
        const e = new BlockEvent<IBlockStub>();
        let calledWith: any = null;
        e.addListener(async (b: IBlockStub) => {
            calledWith = b;
        });

        await e.emit(block);
        expect(calledWith).to.deep.equal(block);
    });

    it("can add and remove a listener", async () => {
        const e = new BlockEvent<IBlockStub>();
        let calledWith: any = null;
        const listener = async (b: IBlockStub) => {
            calledWith = b;
        };

        e.addListener(listener);
        e.removeListener(listener);

        await e.emit(block);
        expect(calledWith).to.be.null;
    });

    it("can add multiple listeners", async () => {
        const e = new BlockEvent<IBlockStub>();
        let calledWith1: any = null;
        const listener1 = async (b: IBlockStub) => {
            calledWith1 = b;
        };
        let calledWith2: any = null;
        const listener2 = async (b: IBlockStub) => {
            calledWith2 = b;
        };

        e.addListener(listener1);
        e.addListener(listener2);

        await e.emit(block);
        expect(calledWith1).to.deep.equal(block);
        expect(calledWith2).to.deep.equal(block);
    });

    fnIt<Event<any>>(e => e.removeListener, "throws ApplicationError if the listener does not exist", async () => {
        const e = new BlockEvent<IBlockStub>();
        const listener = async (b: IBlockStub) => {};
        const otherListener = async (b: IBlockStub) => {};

        e.addListener(listener);
        expect(() => e.removeListener(otherListener), "throws for a listener that was never added").to.throw(ApplicationError);

        e.removeListener(listener);
        expect(() => e.removeListener(listener), "throws for a listener that was already removed").to.throw(ApplicationError);
    });
});
