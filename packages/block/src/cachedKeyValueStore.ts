import { LevelUp, LevelUpChain } from "levelup";
import EncodingDown from "encoding-down";
const sub = require("subleveldown");
import uuid = require("uuid/v4");

import { StartStopService, DbObject, DbObjectOrSerialisable, DbObjectSerialiser, PlainObject } from "@pisa-research/utils";

export interface ItemAndId<TValue> {
    id: string;
    value: TValue;
}

/**
 * This store handles a subdatabase and stores entries that are sets of items indexed by a string key.
 *
 * All the entries are stored in a subdatabase with a prefix specified by the constructor. For each `key` in the store, the class maintains
 * a set of items of type `TValue`. Items are stored with an individual id that is generated at the time of addition (making each of them unique).
 *
 * The store keeps a copy of all the items in memory, and it makes sure that updates on disk are performed after the corresponding successful
 * update on disk, to ensure that copy stored to disk is in a consistent state if a restart is necessary.
 **/
export class CachedKeyValueStore<TValue extends DbObjectOrSerialisable> extends StartStopService {
    private readonly subDb: LevelUp<EncodingDown<string, DbObject>>;
    private items: Map<string, Set<ItemAndId<TValue>>> = new Map();

    /**
     * Creates a store inside db under the prefix `cachedkeyvaluestore-${name}`.
     * @param db
     * @param name
     */
    constructor(db: LevelUp<EncodingDown<string, DbObject>>, private readonly serialiser: DbObjectSerialiser, name: string) {
        super(`cachedkeyvaluestore-${name}`);
        this.subDb = sub(db, `cachedkeyvaluestore-${name}`, { valueEncoding: "json" });
    }

    protected async startInternal() {
        // load existing values from the db
        for await (const record of this.subDb.createReadStream()) {
            const { key: dbKey, value: serialisedValue } = (record as any) as { key: string; value: PlainObject };

            const value = this.serialiser.deserialise<TValue>(serialisedValue);

            const i = dbKey.indexOf(":");
            const key = dbKey.substring(0, i);
            const itemId = dbKey.substring(i + 1);

            const itemWithId = { id: itemId, value: value };

            const keyValues = this.items.get(key);
            if (keyValues) keyValues.add(itemWithId);
            else this.items.set(key, new Set([itemWithId]));
        }
        this.logItemStats("Store started.");
    }

    protected async stopInternal() {
        this.logItemStats("Store stopped.");
    }

    private logItemStats(message: string) {
        const logParams = Array.from(this.items.keys()).map(k => {
            const values = this.items.get(k);
            return { key: k, count: values ? values.size : 0 };
        });

        this.logger.info({ code: "p_ckvs_log", items: logParams }, message);
    }

    /** Returns all the items stored for `key`. */
    public getItems(key: string) {
        return this.items.get(key) || new Set();
    }

    /**
     * Adds `items` to the items stored for `key`, after wrapping each item with a unique `id`.
     * @returns the array of wrapped items.
     */
    public async storeItems(key: string, items: TValue[]): Promise<ItemAndId<TValue>[]> {
        // we forge unique ids for items to uniquely distinguish them in the db
        const itemsWithId = items.map(item => ({ id: uuid(), value: item }));

        // DB
        let batch: LevelUpChain<string, DbObject> = this.subDb.batch();
        itemsWithId.forEach(({ id, value }) => {
            batch = batch.put(key + ":" + id, this.serialiser.serialise(value));
        });
        await batch.write();

        // MEMORY
        const keySet = this.items.get(key);
        if (keySet) itemsWithId.forEach(a => keySet.add(a));
        else this.items.set(key, new Set(itemsWithId));

        return itemsWithId;
    }

    /** Removes the item contained in `itemAndId`  */
    public async removeItem(key: string, itemAndId: ItemAndId<TValue>) {
        // DB
        await this.subDb.del(key + ":" + itemAndId.id);

        // MEMORY
        const items = this.items.get(key);
        if (!items) return;
        else items.delete(itemAndId);
    }
}
