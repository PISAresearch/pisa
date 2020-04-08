import "mocha";
import { expect } from "chai";
import { fnIt } from "@pisa-research/test-utils";
import { ObjectCacheByHeight } from "../src/blockItemStore";
import { defaultSerialiser } from "@pisa-research/utils";
import { ArgumentError } from "@pisa-research/errors";

describe("ObjectCacheByHeight", () => {
    it("curHeight is undefined before adding any object", () => {
        const cache = new ObjectCacheByHeight(defaultSerialiser, 5);
        expect(cache.curHeight).to.be.undefined;
    });

    it("curHeight equals the height the only added element", () => {
        const cache = new ObjectCacheByHeight(defaultSerialiser, 5);
        cache.addObject(42, {});
        expect(cache.curHeight).equals(42);
    });

    it("curHeight equals the maximum height added", () => {
        const cache = new ObjectCacheByHeight(defaultSerialiser, 5);
        cache.addObject(1, {});
        cache.addObject(42, {});
        cache.addObject(99, {});
        cache.addObject(199, {});
        cache.addObject(200, {});
        expect(cache.curHeight).equals(200);
    });

    fnIt<ObjectCacheByHeight>(
        o => o.addObject,
        "adds a new object and returns true",
        () => {
            const cache = new ObjectCacheByHeight(defaultSerialiser, 5);
            expect(cache.addObject(15, { test: "object" })).to.be.true;
        }
    );

    fnIt<ObjectCacheByHeight>(
        o => o.addObject,
        "throws ArgumentError if the height is lower than curHeight",
        () => {
            const cache = new ObjectCacheByHeight(defaultSerialiser, 5);
            expect(cache.addObject(15, { test: "object" })).to.be.true;
            expect(cache.addObject(15, { test: "object2" })).to.be.true;
            expect(() => cache.addObject(14, { test: "object3" })).to.throw(ArgumentError);
        }
    );

    fnIt<ObjectCacheByHeight>(
        o => o.addObject,
        "returns false if an object was previously added",
        () => {
            const cache = new ObjectCacheByHeight(defaultSerialiser, 5);
            expect(cache.addObject(15, { test: "object1" })).to.be.true;
            expect(cache.addObject(16, { test: "object2" })).to.be.true;
            expect(cache.addObject(17, { test: "object1" })).to.be.false;
        }
    );

    it("records stored items up to the depth", () => {
        const depth = 5;
        const maxHeight = 15;
        const cache = new ObjectCacheByHeight(defaultSerialiser, depth);
        const savedObjects = {};
        for (let h = 5; h <= maxHeight; h++) {
            const obj = { height: h };
            cache.addObject(h, obj);
            savedObjects[h] = obj;
        }

        for (let h = maxHeight - depth; h <= maxHeight; h++) {
            const hash = cache.hash({ height: h });
            // asserts strict equality - it must be the same object
            expect(cache.getObject(hash), `should still have objects at hieght ${h}`).to.equal(savedObjects[h]);
        }
    });

    it("prunes items deeper than depth", async () => {
        const depth = 5;
        const maxHeight = 15;
        const cache = new ObjectCacheByHeight(defaultSerialiser, depth);
        const savedObjects = {};
        for (let h = 5; h <= maxHeight; h++) {
            const obj = { height: h };
            cache.addObject(h, obj);
            savedObjects[h] = obj;
        }

        for (let h = 5; h < maxHeight - depth; h++) {
            const hash = cache.hash({ height: h });
            expect(cache.getObject(hash), `should have pruned objects at height ${h}`).to.be.undefined;
        }
    });

    it("records references to the pruned instances of objects if there are more recent copies", () => {
        const obj1 = { test: 42 };
        const obj2 = { test: 100 };

        const depth = 5;

        const cache = new ObjectCacheByHeight(defaultSerialiser, depth);
        cache.addObject(8, obj1);
        cache.addObject(9, obj2);
        cache.addObject(10, obj2);
        cache.addObject(11, obj1);
        cache.addObject(12, obj2);
        cache.addObject(13, obj2);
        cache.addObject(14, obj2);

        // height 8 has been pruned, but the reference returned for an object equal to obj1 should still be the same, as it appears also at height 11
        const hash = cache.hash({ test: 42 });
        expect(cache.getObject(hash)).to.equal(obj1);
    });

    fnIt<ObjectCacheByHeight>(
        o => o.optimiseMappedObject,
        "adds all entries of the mapped object to the cache",
        () => {
            const complexObject = {
                a: { first: "entry" },
                b: { test: 42 },
                c: { some: "object" },
                d: 79, // not an object
                e: { foo: "bar" }
            };

            const cache = new ObjectCacheByHeight(defaultSerialiser, 5);

            cache.optimiseMappedObject(10, complexObject);
            for (const key of ["a", "b", "c", "e"]){
                const hash = cache.hash(complexObject[key]);
                expect(cache.getObject(hash)).to.equal(complexObject[key]);
            }
        }
    );

    fnIt<ObjectCacheByHeight>(
        o => o.optimiseMappedObject,
        "optimises common entries of a new object",
        () => {
            const complexObject = {
                a: { first: "entry" },
                b: { test: 42 },
                c: { some: "object" },
                d: 79, // not an object
                e: { foo: "bar" }
            };

            const complexObject2 = {
                a: { first: "entry" }, // same
                b: { test: 43 }, // different
                c: { some: "different object" }, // different
                d: 100, // not an object
                e: { foo: "bar" } // same
            };

            const cache = new ObjectCacheByHeight(defaultSerialiser, 5);

            cache.optimiseMappedObject(10, complexObject);

            const result = cache.optimiseMappedObject(11, complexObject2);

            // fields "a" end "e" are matching, so it should be recycled from the first object
            // the other ebjects should strictly equal the second object
            expect(result.a).to.equal(complexObject.a);
            expect(result.b).to.equal(complexObject2.b);
            expect(result.c).to.equal(complexObject2.c);
            expect(result.d).to.equal(complexObject2.d);
            expect(result.e).to.equal(complexObject.e);
        }
    );
});
