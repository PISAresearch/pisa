import { LevelUp, LevelUpChain } from "levelup";
import EncodingDown from "encoding-down";
const sub = require("subleveldown");

import { keccak256, toUtf8Bytes } from "ethers/utils";

import { ApplicationError, ArgumentError } from "@pisa-research/errors";
import {
    StartStopService,
    Lock,
    DbObject,
    DbObjectSerialiser,
    PlainObjectOrSerialisable,
    DbObjectOrSerialisable,
    isPrimitive,
    isSerialisable,
    AnyObjectOrSerialisable
} from "@pisa-research/utils";

import { IBlockStub, BlockAndAttached } from "./block";
import { AnchorState } from "./component";

// Objects that are not primimtive but can be stored in the db can be stored in the cache.
type CacheableObject = PlainObjectOrSerialisable | AnyObjectOrSerialisable[];

/**
 * A cache that identifies shared objects built during startup in the BlockItemStore, in order to avoid storing many copies of
 * the same object in RAM. By identifying objects by a cryptographic hash function, we are certain that there won't be collisions.
 * The cache keeps track of a height associated to the objects, and prunes objects deeper than a given depth.
 */
export class ObjectCacheByHeight {
    private readonly objectsByHeight: {
        [height: number]: Map<string, CacheableObject>;
    } = {};
    public mCurHeight: number | undefined = undefined;
    /**
     * Gets the maximum height of added objects.
     */
    public get curHeight() {
        return this.mCurHeight;
    }

    private readonly objectHash = new WeakMap<object, string>();

    constructor(private readonly serialiser: DbObjectSerialiser, public readonly depth: number) {}

    /**
     * Computes the unique hash for the given object. The computed hash is stored in order to not recompute the hash multiple times for the
     * same object (by using the object reference; therefore, the hash of a deeply equal object would be recomputed again).
     * @param object
     */
    public hash(object: CacheableObject) {
        const cachedResult = this.objectHash.get(object);
        if (cachedResult != undefined) return cachedResult;

        // TODO: JSON.stringify is not stable, so it might return different results for objects that are deep equal
        const serialisedObject = this.serialiser.serialise(object);
        const result = keccak256(toUtf8Bytes(JSON.stringify(serialisedObject)));
        this.objectHash.set(object, result);
        return result;
    }

    /**
     * Remove all the stored elements that have an associated height below minHeight.
     * @param minHeight
     */
    private pruneBelowHeight(minHeight: number) {
        Object.keys(this.objectsByHeight)
            .filter(h => Number(h) < minHeight)
            .forEach(h => delete this.objectsByHeight[Number(h)]);
    }

    /**
     * Given a hash, returns the cached object for that hash (if present), or undefined otherwise.
     * @param hash
     */
    public getObject(hash: string): CacheableObject | undefined {
        if (this.curHeight == undefined) return undefined;

        for (let h = this.curHeight; h >= this.curHeight - this.depth; h--) {
            const cachedObject = this.objectsByHeight[h] && this.objectsByHeight[h].get(hash);
            if (cachedObject != undefined) return cachedObject;
        }

        return undefined;
    }

    public static isMappedObject(object: AnyObjectOrSerialisable): object is { [key: string]: AnyObjectOrSerialisable } {
        return !isPrimitive(object) && !Array.isArray(object) && !isSerialisable(object);
    }

    private _addObject(height: number, object: CacheableObject) {
        // Recursively add any subobject that is not primitive
        if (Array.isArray(object)) {
            object.forEach(el => {
                if (!isPrimitive(el)) this._addObject(height, el);
            });
        } else if (!isSerialisable(object)) {
            // If not an array nor a Serialisable, then it is a mapped object.
            // We make sure to add all the subobjects.
            for (const value of Object.values(object)) {
                if (!isPrimitive(value)) this._addObject(height, value);
            }
        }

        const hash = this.hash(object);
        const prevObj = this.getObject(hash);
        if (prevObj != undefined) {
            // Object already in cache
            // We make sure it's also stored at `height` and not just at earlier heights, so it's not pruned prematurely.
            this.objectsByHeight[height].set(hash, prevObj);
            return false;
        } else {
            this.objectsByHeight[height].set(hash, object); // new object that wasn't in cache
            return true;
        }
    }

    /**
     * Adds an object (and all its cacheable sub-objects recursively). Objects are stored for the given height and won't be pruned
     * until curHeight is at least larger than height + depth (including the ones that were already in cache).
     * @param height
     * @param object
     */
    public addObject(height: number, object: CacheableObject) {
        if (this.mCurHeight != undefined) {
            if (height < this.mCurHeight) throw new ArgumentError("Can't add an object below the current height");

            this.mCurHeight = Math.max(this.mCurHeight, height);
        } else {
            this.mCurHeight = height;
        }

        this.pruneBelowHeight(this.mCurHeight - this.depth);

        if (this.objectsByHeight[height] == undefined) this.objectsByHeight[height] = new Map();

        return this._addObject(height, object);
    }

    private optimiseObjectOrPrimitive(obj: AnyObjectOrSerialisable) {
        if (isPrimitive(obj)) return obj;
        else return this.optimiseObject(obj);
    }

    /**
     * Returns an optimised object that is deeply equal to the argument, but where every sub-object that deeply equals some object
     * that was in cache is replaced with a reference to the cached object.
     * If `object` itself is already in cache, then a reference to the cached object is returned; otherwise, a new object is built.
     * If `object` is Serialisable, then `object` itself is returned.
     * It does not add `object` (or any of the nested sub-objects) to the cache.
     * @param obj
     */
    public optimiseObject(obj: CacheableObject): CacheableObject {
        // If object is cached, return the cached copy
        const hash = this.hash(obj);
        const cachedObject = this.getObject(hash);
        if (cachedObject != undefined) return cachedObject;

        if (Array.isArray(obj)) return (obj as AnyObjectOrSerialisable[]).map(el => this.optimiseObjectOrPrimitive(el));
        else if (isSerialisable(obj)) return obj;
        else {
            const result: { [key: string]: AnyObjectOrSerialisable } = {};
            for (const [key, subObj] of Object.entries(obj)) {
                result[key] = this.optimiseObjectOrPrimitive(subObj);
            }
            return result;
        }
    }
}

/**
 * This store is a support structure for the block cache and all the related components that need to store blocks and other data that
 * is attached to those blocks, but pruning data that is too old. All the items are stored by block number and block hash, and can be
 * retrieved by block hash only. Moreover, there are methods to retrieve and/or delete all the blocks (and any attached info) at a certain height.
 *
 * All write actions must be executed within a `withBatch` callback, and they are effective immediately in memory, but all the writes performed
 * in the same `withBatch` call are either successfully written to the database, or not. This can be used to guarantee that the state that is
 * persisted in the database is always consistent, and can be therefore be used as a checkpoint to restart the application.
 */
export class BlockItemStore<TBlock extends IBlockStub> extends StartStopService {
    // Keys used by the BlockCache
    /** Stores the content of the block. */
    private static KEY_BLOCK = "block";
    /** True if the block was attached to the BlockCache; otherwise the block is still 'detached'. */
    private static KEY_ATTACHED = "attached";

    // Keys used by the BlockchainMachine
    /** Stores the anchor state computed for this block; indexed by component. */
    private static KEY_STATE = "state";

    private readonly subDb: LevelUp<EncodingDown<string, DbObject>>;
    constructor(db: LevelUp<EncodingDown<string, DbObject>>, private readonly serialiser: DbObjectSerialiser) {
        super("block-item-store");
        this.subDb = sub(db, `block-item-store`, { valueEncoding: "json" });
    }

    private itemsByHeight: Map<number, Set<string>> = new Map();
    private items: Map<string, DbObjectOrSerialisable> = new Map();

    private mBatch: LevelUpChain<string, DbObject> | null = null;
    private get batch() {
        if (!this.mBatch) throw new ApplicationError("Write accesses must be executed within a withBatch callback.");
        return this.mBatch;
    }

    protected async startInternal() {
        const objectCache = new ObjectCacheByHeight(this.serialiser, 1);
        // load all items from the db
        for await (const record of this.subDb.createReadStream()) {
            const { key, value } = (record as any) as { key: string; value: any };
            console.log(`${key}: ${JSON.stringify(value)}`);

            const i = key.indexOf(":");
            const height = Number.parseInt(key.substring(0, i));
            const memKey = key.substring(i + 1);

            const deserialised = this.serialiser.deserialise<DbObjectOrSerialisable>(value);
            if (isPrimitive(deserialised)) {
                this.setItem(height, memKey, deserialised);
            } else {
                objectCache.addObject(height, deserialised);
                this.setItem(height, memKey, objectCache.optimiseObject(deserialised));
            }

            if (memKey.endsWith(`:${BlockItemStore.KEY_STATE}`)) {
                this.mHasAnyAnchorStates = true;
            }
        }

        this.logger.info({ itemsByHeightCount: this.itemsByHeight.size, itemsCount: this.items.size }, "Store started.");
    }
    protected async stopInternal() {
        this.logger.info({ itemsByHeightCount: this.itemsByHeight.size, itemsCount: this.items.size }, "Store stopped.");
    }

    /**
     * Should only be used internally, kept public for testing.
     * Writes `item` for the `blockHash` at height `blockHeight` under the key `itemKey`.
     **/
    public putBlockItem(blockHeight: number, blockHash: string, itemKey: string, item: DbObjectOrSerialisable) {
        const memKey = `${blockHash}:${itemKey}`;
        const dbKey = `${blockHeight}:${memKey}`;

        this.setItem(blockHeight, memKey, item);

        this.batch.put(dbKey, this.serialiser.serialise(item));
    }

    /**
     * Gets the item with key `itemKey` for block `blockHash`.
     * Returns `undefined` if a key is not present.
     **/
    public getItem(blockHash: string, itemKey: string): DbObjectOrSerialisable | undefined {
        const memKey = `${blockHash}:${itemKey}`;
        return this.items.get(memKey);
    }

    private setItem(height: number, memKey: string, item: DbObjectOrSerialisable) {
        const itemsAtHeight = this.itemsByHeight.get(height);
        if (itemsAtHeight) itemsAtHeight.add(memKey);
        else this.itemsByHeight.set(height, new Set([memKey]));

        this.items.set(memKey, item);
    }

    // Type safe methods to store blocks
    public block = {
        get: (blockHash: string): TBlock | undefined =>
            this.getItem(blockHash, BlockItemStore.KEY_BLOCK) as unknown as TBlock | undefined, // prettier-ignore
        set: (blockHeight: number, blockHash: string, block: TBlock) =>
            this.putBlockItem(blockHeight, blockHash, BlockItemStore.KEY_BLOCK, block) // prettier-ignore
    };

    // Type safe methods to store the "attached" boolean for each block (used in the BlockCache)
    public attached = {
        get: (blockHash: string): boolean | undefined =>
            this.getItem(blockHash, BlockItemStore.KEY_ATTACHED) as unknown as boolean, // prettier-ignore
        set: (blockHeight: number, blockHash: string, attached: boolean) =>
            this.putBlockItem(blockHeight, blockHash, BlockItemStore.KEY_ATTACHED, attached) // prettier-ignore
    };

    // Type safe methods to store the anchor state for each block, indexed by component (used in the BlockchainMachine)
    private mHasAnyAnchorStates = false;
    /**
     * True when at least one anchor state state was saved into the store, false otherwise.
     */
    public get hasAnyAnchorStates() {
        return this.mHasAnyAnchorStates;
    }
    public anchorState = {
        get: <TAnchorState extends PlainObjectOrSerialisable>(componentName: string, blockHash: string) =>
            (this.getItem(blockHash, `${componentName}:${BlockItemStore.KEY_STATE}`) as unknown) as TAnchorState | undefined,
        set: (componentName: string, blockHeight: number, blockHash: string, newState: AnchorState) => {
            this.putBlockItem(blockHeight, blockHash, `${componentName}:${BlockItemStore.KEY_STATE}`, newState);
            this.mHasAnyAnchorStates = true;
        }
    };

    /**
     * Returns the blocks for the specific height, and whether they are attached or not.
     * Blocks are stored under the key `BlockItemStore.KEY_BLOCK`, and wether they are attached is in `BlockItemStore.KEY_ATTACHED`.
     **/
    public getBlocksAtHeight(height: number): BlockAndAttached<TBlock>[] {
        const itemsAtHeight = this.itemsByHeight.get(height) || new Set();
        // collect blocks and attachment info

        const blocks: BlockAndAttached<TBlock>[] = [];

        for (const item of itemsAtHeight) {
            // check if it is the actual block
            const blockItemSuffix = `:${BlockItemStore.KEY_BLOCK}`;
            if (item.endsWith(blockItemSuffix)) {
                const blockHash = item.slice(0, -blockItemSuffix.length);
                const block = this.block.get(blockHash)!;
                const attached = this.attached.get(blockHash)!;
                blocks.push({ block, attached });
            }
        }
        return blocks;
    }

    /** Delete all blocks and other indexed items for that height. */
    public deleteItemsAtHeight(height: number) {
        const itemsAtHeight = this.itemsByHeight.get(height);
        if (itemsAtHeight) {
            this.itemsByHeight.delete(height);
            for (const key of itemsAtHeight) {
                const dbKey = `${height}:${key}`;
                this.batch.del(dbKey);
                this.items.delete(key);
            }
        }
    }

    // we should lock during a batch, so that batches being taken out by
    // different process wait behind each other
    private batchLock = new Lock();

    /**
     * Executes a sequence with write access to the db. All writes are effective in memory immediately, but they are only written to disk
     * atomically at the end of the sequence.
     * If `callback` is rejected, or if the write to disk fails, this call will reject with the same error.
     * Such errors must be taken seriously, as they might imply that sequence of updates is partially executed in memory, but did not complete correctly,
     * potentially causing an inconsistent state. As the write to db happens atomically, restarting is a viable option and should always recover from a
     * consistent state.
     *
     * @throws ApplicationError if there is already an open batch that did not yet close.
     */
    public async withBatch<TReturn>(callback: () => Promise<TReturn>) {
        try {
            await this.batchLock.acquire();

            if (this.mBatch) {
                throw new ApplicationError("There is already an open batch.");
            }

            this.mBatch = this.subDb.batch();

            const callBackResult = await callback();

            const beforeBatchWrite = Date.now();
            await this.mBatch.write();
            this.logger.info({ duration: Date.now() - beforeBatchWrite, length: this.mBatch.length, code: "items-store-batch-write" }, "Batch written.");

            return callBackResult;
        } finally {
            this.mBatch = null;
            this.batchLock.release();
        }
    }
}
