import "mocha";
import { expect } from "chai";

import levelUp, { LevelUp } from "levelup";
import EncodingDown from "encoding-down";
import MemDown from "memdown";

import { fnIt, wait } from "@pisa-research/test-utils";
import { DbObject, Serialisable, Serialised, defaultDeserialisers, DbObjectSerialiser } from "@pisa-research/utils";
import { ApplicationError } from "@pisa-research/errors";

import { ObjectCache, BlockItemStore } from "../src/blockItemStore";
import { IBlockStub } from "../src";

/**
 * A test Serialisable class.
 */
class SerialisableThing implements Serialisable {
    public static TYPE = "thing";

    constructor(public readonly thing: string) {}

    public serialise() {
        return {
            __type__: SerialisableThing.TYPE,
            thing: this.thing
        };
    }

    public static deserialise(obj: Serialised<SerialisableThing>): SerialisableThing {
        if (obj.__type__ !== SerialisableThing.TYPE) throw new ApplicationError(`Unexpected __type__ while deserialising SerialisableThing: ${obj.__type__}`); // prettier-ignore

        return new SerialisableThing(obj.thing);
    }
}

const serialiser = new DbObjectSerialiser({
    ...defaultDeserialisers,
    [SerialisableThing.TYPE]: SerialisableThing.deserialise
});

describe("ObjectCache", () => {
    fnIt<ObjectCache>(
        o => o.addObject,
        "adds a new object and returns true",
        () => {
            const cache = new ObjectCache(serialiser);
            expect(cache.addObject({ test: "object" })).to.be.true;
        }
    );

    fnIt<ObjectCache>(
        o => o.addObject,
        "returns false if an object was previously added",
        () => {
            const cache = new ObjectCache(serialiser);
            expect(cache.addObject({ test: "object1" })).to.be.true;
            expect(cache.addObject({ test: "object2" })).to.be.true;
            expect(cache.addObject({ test: "object1" })).to.be.false;
        }
    );

    fnIt<ObjectCache>(
        o => o.addObject,
        "also adds subobjects recursively",
        () => {
            const cache = new ObjectCache(serialiser);
            const obj = {
                subobject: { test: 1 },
                array: [{ test: 2 }, 5, false],
                serialisable: new SerialisableThing("apple")
            };
            expect(cache.addObject(obj)).to.be.true;
            expect(cache.addObject({ test: 1 })).to.be.false; // added as an inner object
            expect(cache.addObject({ test: 2 })).to.be.false; // added as element of the array
            expect(cache.addObject(new SerialisableThing("apple"))).to.be.false; // sarialisable objects are added too
        }
    );

    fnIt<ObjectCache>(
        o => o.optimiseObject,
        "replaces nested object entries that were already added to the cache",
        () => {
            const complexObject1 = {
                a: { first: "entry" },
                b: { test: 42 },
                c: { some: "object" },
                d: 79, // not an object
                e: [2, { foo: "bar" }]
            };

            const complexObject2 = {
                a: { first: "entry" }, // same
                b: { test: 43 }, // different
                c: { some: "different object" }, // different
                d: 100, // not an object
                ZZZ: [{ foo: "bar" }, true] // has a shared object with an array in complexObject1
            };

            const cache = new ObjectCache(serialiser);

            cache.addObject(complexObject1);

            const result: any = cache.optimiseObject(complexObject2);

            // fields "a" end one of the element of the array are matching, so while the object should deep equal
            // complexObject2, those common parts should be identically equal to the references in complexObject1
            expect(result).to.deep.equal(complexObject2);
            expect(result["a"]).to.equal(complexObject1.a);
            expect(result["ZZZ"][0]).to.equal(complexObject1.e[1]);
        }
    );

    fnIt<ObjectCache>(
        o => o.optimiseObject,
        "returns the passed object if already in cache",
        () => {
            const obj = { foo: "bar" };
            const cache = new ObjectCache(serialiser);

            cache.addObject(obj);

            expect(cache.optimiseObject(obj)).to.equal(obj);
        }
    );

    fnIt<ObjectCache>(
        o => o.optimiseObject,
        "returns the passed Serialisable if already in cache",
        () => {
            const obj = new SerialisableThing("pear");
            const cache = new ObjectCache(serialiser);

            cache.addObject(obj);

            expect(cache.optimiseObject(obj)).to.equal(obj);
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
        store = new BlockItemStore<IBlockStub>(db, serialiser);
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
        const newStore = new BlockItemStore<IBlockStub>(db, serialiser);
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
