import "mocha";
import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised"
import { fnIt } from "@pisa-research/test-utils";
import { DbObjectSerialiser, SerialisableBigNumber } from "../src";
use(chaiAsPromised);

describe("DbObjectSerialiser", () => {
    const plainObjects = [
        true, false, 5, "", "a string", [], [1, 5, "test"],
        {}, { foo: "bar" },
        [ undefined, null, 5], { und: undefined, nul: null }, // arrays and objects can contain undefined or null
        { // a complex object
            b: true,
            array: [3, true, { some: "object" }],
            obj: {
                answer: 42,
                nested: { anotherArray: [1, null, { even: "more nesting" }]}
            }
        }
    ];

    fnIt<DbObjectSerialiser>(p => p.serialise, "leaves primitive types and plain objects unchanged", () => {
        const pos = new DbObjectSerialiser({ [SerialisableBigNumber.TYPE]: SerialisableBigNumber.deserialise });

        for (const obj of plainObjects) {
            expect(pos.serialise(obj)).to.deep.equal(obj);
        }
    });
});
