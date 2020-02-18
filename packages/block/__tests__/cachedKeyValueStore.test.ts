import "mocha";
import { expect } from "chai";
import { CachedKeyValueStore } from "../src/cachedKeyValueStore";
import LevelUp from "levelup";
import EncodingDown from "encoding-down";
import MemDown from "memdown";
import { fnIt } from "@pisa-research/test-utils";
import { DbObject } from "@pisa-research/utils";


type TestItem = {
    name: string;
}

describe("CachedKeyValueStore", () => {
    let store: CachedKeyValueStore<TestItem>;
    let db: any;

    const key = "awesome-component";
    const testItems: TestItem[] = [
        {
            name: "item1"
        },
        {
            name: "item2"
        }
    ];

    beforeEach(async () => {
        db = LevelUp(EncodingDown<string, DbObject>(MemDown(), { valueEncoding: "json" }));
        store = new CachedKeyValueStore(db, "prefix");
        await store.start();
    });

    afterEach(async () => {
        if (store.started) await store.stop();
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

        const newStore = new CachedKeyValueStore(db, "prefix"); // a new CachedKeyValueStore on the same db
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

        const newStore = new CachedKeyValueStore(db, "prefix"); // a new CachedKeyValueStore on the same db
        await newStore.start();

        const retrievedItemsAfter = [...newStore.getItems(key)].map(i => i.value);
        await newStore.stop();
        expect(retrievedItemsAfter).to.deep.equal([testItems[1]]); // should only contain the second item
    });
});
