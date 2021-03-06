import "mocha";
import { expect } from "chai";
import { CachedKeyValueStore } from "../src/cachedKeyValueStore";
import LevelUp from "levelup";
import EncodingDown from "encoding-down";
import MemDown from "memdown";
import { fnIt } from "@pisa-research/test-utils";
import { DbObject, defaultSerialiser, SerialisableBigNumber, Logger } from "@pisa-research/utils";

const logger = Logger.getLogger();

type TestItem = {
    name: string;
    bigNum: SerialisableBigNumber
}

describe("CachedKeyValueStore", () => {
    let store: CachedKeyValueStore<TestItem>;
    let db: any;

    const key = "awesome-component";
    const testItems: TestItem[] = [
        {
            name: "item1",
            bigNum: new SerialisableBigNumber(42)
        },
        {
            name: "item2",
            bigNum: new SerialisableBigNumber(43)
        }
    ];

    beforeEach(async () => {
        db = LevelUp(EncodingDown<string, DbObject>(MemDown(), { valueEncoding: "json" }));
        store = new CachedKeyValueStore(db, defaultSerialiser, "prefix", logger);
        await store.start();
    });

    afterEach(async () => {
        if (store.started) await store.stop();
    });

    it("can store an retrieve some items", async () => {
        await store.storeItems(key, testItems);

        const retrievedItems = [...store.getItems(key)].map(i => i.value);
        expect(retrievedItems.length, "retrieves the correct number of stored items").to.equal(testItems.length);
        for (let i = 0; i < testItems.length; i++) {
            expect(retrievedItems[i].name, "retrieves a primitive value").to.equal(testItems[i].name);
            expect(retrievedItems[i].bigNum.eq(testItems[i].bigNum), "retrieves a deserialised value").to.be.true;
        }
    });

    it("can store an retrieve some items", async () => {
        await store.storeItems(key, testItems);

        const retrievedItems = [...store.getItems(key)].map(i => i.value);
        expect(retrievedItems).to.deep.equal(testItems);
    });

    fnIt<CachedKeyValueStore<TestItem>>(c => c.storeItems, "returns wrapped all the wrapped items and ids", async () => {
        const itemsAndIds = await store.storeItems(key, testItems);

        expect(testItems.length).to.equal(itemsAndIds.length);
        for (let i = 0; i < testItems.length; i++) {
            expect(itemsAndIds[i].value).to.deep.equal(testItems[i]);
        }
    });

    fnIt<CachedKeyValueStore<TestItem>>(c => c.removeItem, "removes an item", async () => {
        await store.storeItems(key, testItems);

        const retrievedItemsAndId = [...store.getItems(key)];

        await store.removeItem(key, retrievedItemsAndId[0]); // delete the first item

        const retrievedItemsAfter = [...store.getItems(key)].map(i => i.value);
        expect(retrievedItemsAfter).to.deep.equal([testItems[1]]); // should only contain the second item
    });

    it("reloads items from the db on startup", async () => {
        await store.storeItems(key, testItems);
        await store.stop();

        const newStore = new CachedKeyValueStore(db, defaultSerialiser, "prefix", logger); // a new CachedKeyValueStore on the same db
        await newStore.start();

        const retrievedItems = [...newStore.getItems(key)]
            .map(a => a.value) // prettier-ignore
            .sort((a, b) => ((a as any).name < (b as any).name ? -1 : 1)); // make sure they are checked in the same order

        await newStore.stop();

        expect(retrievedItems).to.deep.equal(testItems);
    });

    fnIt<CachedKeyValueStore<TestItem>>(c => c.removeItem, "removes an item in memory and also removes from the db", async () => {
        // make sure that deleted items are also deleted from the db, and not just locally

        await store.storeItems(key, testItems);
        const retrievedItemsAndId = [...store.getItems(key)];

        await store.removeItem(key, retrievedItemsAndId[0]); // delete the first item

        await store.stop();

        const newStore = new CachedKeyValueStore(db, defaultSerialiser, "prefix", logger); // a new CachedKeyValueStore on the same db
        await newStore.start();

        const retrievedItemsAfter = [...newStore.getItems(key)].map(i => i.value);
        await newStore.stop();
        expect(retrievedItemsAfter).to.deep.equal([testItems[1]]); // should only contain the second item
    });
});
