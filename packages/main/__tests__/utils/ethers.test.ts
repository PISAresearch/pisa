import "mocha";
import { expect } from "chai";

import { defaultAbiCoder } from "ethers/utils";

import { encodeTopicsForPisa } from "../../src/utils/ethers";
import { ApplicationError } from "@pisa/errors";

describe("encodeTopicsForPisa", () => {
    const zero        = "0x0000000000000000000000000000000000000000000000000000000000000000"
    const dummyBytes1 = "0x0011223344556677889900112233445566778899001122334455667788990011";
    const dummyBytes2 = "0x2222222222222222222222222222222222222222222222222222222222222222";
    const dummyBytes3 = "0x3333333333333333333333333333333333333333333333333333333333333333";
    const dummyBytes4 = "0x4444444444444444444444444444444444444444444444444444444444444444";
    const dummyBytes5 = "0x5555555555555555555555555555555555555555555555555555555555555555";
    it("correctly encodes empty or null topics", () => {
        const expected = defaultAbiCoder.encode(["bool[4]", "bytes32[4]"], [
            [false, false, false, false],
            [zero, zero, zero, zero]
        ]);
        expect(encodeTopicsForPisa([])).to.equal(expected);
        expect(encodeTopicsForPisa([null])).to.equal(expected);
        expect(encodeTopicsForPisa([null, null])).to.equal(expected);
        expect(encodeTopicsForPisa([null, null, null])).to.equal(expected);
        expect(encodeTopicsForPisa([null, null, null, null])).to.equal(expected);
    });

    it("correctly encodes all topics", () => {
        const expected = defaultAbiCoder.encode(["bool[4]", "bytes32[4]"], [
            [true, true, true, true],
            [dummyBytes1, dummyBytes2, dummyBytes3, dummyBytes4]
        ]);
        expect(encodeTopicsForPisa([dummyBytes1, dummyBytes2, dummyBytes3, dummyBytes4])).to.equal(expected);
    });

    it("correctly a missing topic set to null", () => {
        const expected = defaultAbiCoder.encode(["bool[4]", "bytes32[4]"], [
            [true, false, true, false],
            [dummyBytes1, zero, dummyBytes3, zero]
        ]);
        expect(encodeTopicsForPisa([dummyBytes1, null, dummyBytes3])).to.equal(expected);
    });

    it("throws ApplicationError if more than 4 topics are passed", () => {
        expect(() => encodeTopicsForPisa([dummyBytes1, dummyBytes2, dummyBytes3, dummyBytes4, dummyBytes5])).to.throw(ApplicationError);
        expect(() => encodeTopicsForPisa([null, null, null, null, dummyBytes5])).to.throw(ApplicationError);
    });
});