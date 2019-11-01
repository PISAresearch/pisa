import "mocha";
import { expect } from "chai";
import { ArgumentError } from "@pisa/errors";
import { fnIt } from "@pisa/test-utils";
import { MapOfSets } from "../src";

describe("MapSet", () => {
    const key1 = "key1";
    const key2 = "key2";
    const val1 = "val1";
    const val2 = "val2";

    fnIt<MapOfSets<any, any>>(map => map.addToSet, "adds new key", () => {
        const map = new MapOfSets<string, string>();
        map.addToSet(key1, val1);
        expect(map.get(key1)).to.deep.equal(new Set([val1]));
    });

    fnIt<MapOfSets<any, any>>(map => map.addToSet, "adds to existing key", () => {
        const map = new MapOfSets<string, string>();
        map.addToSet(key1, val1);
        map.addToSet(key1, val2);
        expect(map.get(key1)).to.deep.equal(new Set([val1, val2]));
    });

    fnIt<MapOfSets<any, any>>(map => map.addToSet, "does not add existing value", () => {
        const map = new MapOfSets<string, string>();
        map.addToSet(key1, val1);
        map.addToSet(key1, val1);
        expect(map.get(key1)).to.deep.equal(new Set([val1]));
    });

    fnIt<MapOfSets<any, any>>(map => map.deleteFromSet, "does delete a value", () => {
        const map = new MapOfSets<string, string>();
        map.set(key1, new Set([val1, val2]));

        expect(map.deleteFromSet(key1, val2)).to.be.true;
        expect(map.get(key1)).to.deep.equal(new Set([val1]));
    });

    fnIt<MapOfSets<any, any>>(map => map.deleteFromSet, "does not delete non existent value", () => {
        const map = new MapOfSets<string, string>();
        map.set(key1, new Set([val1]));

        expect(map.deleteFromSet(key1, val2)).to.be.false;
        expect(map.get(key1)).to.deep.equal(new Set([val1]));
    });

    fnIt<MapOfSets<any, any>>(map => map.deleteFromSet, "does delete key if no values remain", () => {
        const map = new MapOfSets<string, string>();
        map.set(key1, new Set([val1]));

        expect(map.deleteFromSet(key1, val1)).to.be.true;
        expect(map.get(key1)).to.be.undefined;
    });

    fnIt<MapOfSets<any, any>>(map => map.deleteFromSet, "throws error for non existent key", () => {
        const map = new MapOfSets<string, string>();
        map.set(key1, new Set([val1]));

        expect(() => map.deleteFromSet(key2, val1)).to.throw(ArgumentError);
        expect(map.get(key1)).to.deep.equal(new Set([val1]));
    });
});
