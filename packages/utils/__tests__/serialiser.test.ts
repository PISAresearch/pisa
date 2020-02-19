import "mocha";
import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised"
import { BigNumber } from "ethers/utils";
import { fnIt } from "@pisa-research/test-utils";
import { DbObjectSerialiser, SerialisableBigNumber, DbObjectOrSerialisable, PlainObject } from "../src";
import { ApplicationError } from "@pisa-research/errors";
use(chaiAsPromised);

describe("SerialisableBigNumber", () => {
    fnIt<SerialisableBigNumber>(sbn => sbn.serialise, "serialises correctly", () => {
        expect(new SerialisableBigNumber("0x42").serialise()).to.deep.equal({_type: SerialisableBigNumber.TYPE, value: "0x42" });
    });

    fnIt<SerialisableBigNumber>(() => SerialisableBigNumber.deserialise, "deserialises correctly", () => {
        expect(SerialisableBigNumber.deserialise({_type: SerialisableBigNumber.TYPE, value: "0x42" }).eq(new BigNumber("0x42"))).to.be.true;
    });
});

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

    const complexObject: DbObjectOrSerialisable = {
        nil: null,
        nested: {
            num: new SerialisableBigNumber("0x42")
        }
    };
    const serialisedComplexObject: PlainObject = {
        nil: null,
        nested: {
            num: {
                _type: SerialisableBigNumber.TYPE,
                value: "0x42"
            }
        }
    };

    fnIt<DbObjectSerialiser>(p => p.serialise, "leaves primitive types and plain objects unchanged", () => {
        const dos = new DbObjectSerialiser({});

        for (const obj of plainObjects) {
            expect(dos.serialise(obj)).to.deep.equal(obj);
        }
    });

    fnIt<DbObjectSerialiser>(p => p.serialise, "leaves primitive types and plain objects unchanged", () => {
        const dos = new DbObjectSerialiser({});

        for (const obj of plainObjects) {
            expect(dos.serialise(obj)).to.deep.equal(obj);
        }
    });

    fnIt<DbObjectSerialiser>(p => p.serialise, "correctly serialises an object with a nested Serialisable element", () => {
        const dos = new DbObjectSerialiser({ [SerialisableBigNumber.TYPE]: SerialisableBigNumber.deserialise });

        expect(dos.serialise(complexObject)).to.deep.equal(serialisedComplexObject);
    });

    fnIt<DbObjectSerialiser>(p => p.serialise, "correctly deserialises an object with a nested Serialisable element", () => {
        const dos = new DbObjectSerialiser({ [SerialisableBigNumber.TYPE]: SerialisableBigNumber.deserialise });

        const deserialisedResult: any = dos.deserialise(serialisedComplexObject);
        //can't deep compare, as it contains BigNumbers
        expect(deserialisedResult.nil).to.deep.equal(complexObject.nil);
        expect(deserialisedResult.nested.num.eq((complexObject as any).nested.num)).to.be.true;
    });

    fnIt<DbObjectSerialiser>(p => p.serialise, "throws when a serialised object is of an unknown type", () => {
        const dos = new DbObjectSerialiser({ [SerialisableBigNumber.TYPE]: SerialisableBigNumber.deserialise });

        const serialised = {
            random: "value",
            nested: {
                invalid: { // a serialised element of unknown type "foo"
                    _type: "foo",
                    bar: 42
                }
            }
        };

        expect(() => dos.deserialise(serialised)).to.throw(ApplicationError);
    });

});
