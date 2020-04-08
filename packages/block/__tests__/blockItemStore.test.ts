import "mocha";
import { expect } from "chai";

import levelUp, { LevelUp } from "levelup";
import EncodingDown from "encoding-down";
import MemDown from "memdown";

import { fnIt, wait } from "@pisa-research/test-utils";
import { defaultSerialiser, DbObject } from "@pisa-research/utils";
import { ObjectCacheByHeight, BlockItemStore } from "../src/blockItemStore";
import { ArgumentError, ApplicationError } from "@pisa-research/errors";
import { IBlockStub } from "../src";

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
            for (const key of ["a", "b", "c", "e"]) {
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

describe("BlockItemStore", () => {
    let db: LevelUp<EncodingDown<string, DbObject>>;
    let store: BlockItemStore<IBlockStub>;

    const sampleKey = "foo";
    const sampleValue = {
        bar: 42
    };

    const block10a = {
        number: 10,
        hash: "0xaaaa",
        parentHash: "0x1111"
    };
    const block10b = {
        number: 10,
        hash: "0xbbbb",
        parentHash: "0x2222"
    };
    const block42 = {
        number: 42,
        hash: "0x4242",
        parentHash: "0x3333"
    };

    const sampleBlocks: IBlockStub[] = [block10a, block10b, block42];

    async function addSampleData(bis: BlockItemStore<IBlockStub>) {
        await store.withBatch(async () => {
            bis.putBlockItem(block10a.number, block10a.hash, "block", block10a);
            bis.putBlockItem(block10a.number, block10a.hash, "attached", true);
            bis.putBlockItem(block42.number, block42.hash, "block", block42);
            bis.putBlockItem(block42.number, block42.hash, "attached", true);
            bis.putBlockItem(block10b.number, block10b.hash, "block", block10b);
            bis.putBlockItem(block10b.number, block10b.hash, "attached", false);
        });
    }

    beforeEach(async () => {
        db = levelUp(
            EncodingDown<string, DbObject>(MemDown(), { valueEncoding: "json" })
        );
        store = new BlockItemStore<IBlockStub>(db, defaultSerialiser);
        await store.start();
    });

    afterEach(async () => {
        await store.stop();
    });

    it("can store and retrieve an item", async () => {
        await store.withBatch(async () => store.putBlockItem(sampleBlocks[0].number, sampleBlocks[0].hash, sampleKey, sampleValue));

        const storedItem = store.getItem(sampleBlocks[0].hash, sampleKey);

        expect(storedItem).to.deep.equal(sampleValue);
    });

    fnIt<BlockItemStore<any>>(
        b => b.putBlockItem,
        "throws ApplicationError if not executed within a withBatch callback",
        async () => {
            expect(() => store.putBlockItem(42, "0x424242", "test", {})).to.throw(ApplicationError);
        }
    );

    fnIt<BlockItemStore<any>>(
        b => b.withBatch,
        "rejects with the same error if the callback rejects",
        async () => {
            const doh = new Error("Oh no!");
            expect(
                store.withBatch(async () => {
                    throw doh;
                })
            ).to.be.rejectedWith(doh);
        }
    );

    fnIt<BlockItemStore<any>>(
        b => b.withBatch,
        "timesout if a batch was already open",
        async () => {
            await store.withBatch(async () => {
                const startTime = Date.now();
                await Promise.race([store.withBatch(async () => {}), wait(1000)]);

                expect(Date.now() - startTime).to.be.gte(1000);
                expect(Date.now() - startTime).to.be.lessThan(2000);
            });
        }
    );

    fnIt<BlockItemStore<any>>(
        b => b.getBlocksAtHeight,
        "gets all the blocks at a specific height and correctly reads the `attached` property",
        async () => {
            await addSampleData(store);

            // sort the returned elements, as order is not relevant
            const result = store.getBlocksAtHeight(10).sort((a, b) => (a.block.hash < b.block.hash ? -1 : 1));

            expect(result.length, "returns the right number of blocks").to.equal(2);
            expect(result[0].block).to.deep.equal(block10a);
            expect(result[0].attached).to.be.true;
            expect(result[1].block).to.deep.equal(block10b);
            expect(result[1].attached).to.be.false;
        }
    );

    fnIt<BlockItemStore<any>>(
        b => b.deleteItemsAtHeight,
        "deletes all the items at a specific height",
        async () => {
            await addSampleData(store);

            await store.withBatch(async () => store.deleteItemsAtHeight(10));

            // Check that all items at height 10 return undefined, but all the others are not changed
            expect(store.getItem(block10a.hash, "block")).to.be.undefined;
            expect(store.getItem(block10a.hash, "attached")).to.be.undefined;
            expect(store.getItem(block42.hash, "block")).to.deep.include(block42);
            expect(store.getItem(block42.hash, "attached")).to.be.true;
            expect(store.getItem(block10b.hash, "block")).to.be.undefined;
            expect(store.getItem(block10b.hash, "attached")).to.be.undefined;
        }
    );

    it("actually persists items into the database", async () => {
        await addSampleData(store);
        await store.stop();

        // New store using the same db
        const newStore = new BlockItemStore<IBlockStub>(db, defaultSerialiser);
        await newStore.start();

        // Check that all items still return the correct value for the new store
        expect(newStore.getItem(block10a.hash, "block")).to.deep.include(block10a);
        expect(newStore.getItem(block10a.hash, "attached")).to.be.true;
        expect(newStore.getItem(block42.hash, "block")).to.deep.include(block42);
        expect(newStore.getItem(block42.hash, "attached")).to.be.true;
        expect(newStore.getItem(block10b.hash, "block")).to.deep.include(block10b);
        expect(newStore.getItem(block10b.hash, "attached")).to.be.false;
    });
});
