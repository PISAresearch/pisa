import "mocha";
import { expect } from "chai";
import { hasLogMatchingEventFilter, Logs } from "../src";
import { ArgumentError } from "@pisa-research/errors";

describe("hasLogMatchingEventFilter", () => {
    const address = "0x1234abcd";
    const addressDifferentCase = "0x1234AbCd"; // should match anyway
    const topics = ["0xaabbccdd"];
    const topicsDifferentCase = ["0xAaBbCcDd"]; // should match anyway

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
        expect(hasLogMatchingEventFilter(blockHasLogs, { address: addressDifferentCase, topics }), "matches even if address' case is different").to.be.true;
        expect(hasLogMatchingEventFilter(blockHasLogs, { address, topics: topicsDifferentCase }), "matches even if topics' case is different").to.be.true;
    });

    it("returns false if an appropriate log is not present", () => {
        expect(hasLogMatchingEventFilter(blockDoesNotHaveLogs, { address, topics })).to.be.false;
        expect(hasLogMatchingEventFilter(blockHasLogs, { address: "0xanotheraddress", topics })).to.be.false;
    });
    it("throws ArgumentError if no address is provided", () => {
        expect(() => hasLogMatchingEventFilter(blockHasLogs, { topics })).to.throw(ArgumentError);
    });
    it("throws ArgumentError if no topics member is present in filter", () => {
        expect(() => hasLogMatchingEventFilter(blockHasLogs, { address })).to.throw(ArgumentError);
    });
});
