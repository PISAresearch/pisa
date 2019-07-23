import "mocha";
import { expect } from "chai";

import { hasLogMatchingEventFilter, Logs } from "../../../src/dataEntities/block";
import { ArgumentError } from "../../../src/dataEntities";

describe("hasLogMatchingEventFilter", () => {
    const address = "0x1234";
    const topics = ["0xaabbccdd"];

    const blockHasLogs: Logs = {
        logs: [
            {
                address,
                data: "",
                topics
            }
        ]
    };

    const blockDoesNotHaveLogs: Logs = {
        logs: [
            {
                address,
                data: "",
                topics: ["0xbeef"] // different topics
            }
        ]
    };

    it("returns true if an appropriate log is present", () => {
        expect(hasLogMatchingEventFilter(blockHasLogs, { address, topics })).to.be.true;
    });

    it("returns false if an appropriate log is present", () => {
        expect(hasLogMatchingEventFilter(blockDoesNotHaveLogs, { address, topics })).to.be.false;
    });
    it("throws ArgumentError if no address is provided", () => {
        expect(() => hasLogMatchingEventFilter(blockHasLogs, { topics })).to.throw(ArgumentError);
    });
    it("throws ArgumentError if no topics member is present in filter", () => {
        expect(() => hasLogMatchingEventFilter(blockHasLogs, { address })).to.throw(ArgumentError);
    });
});
