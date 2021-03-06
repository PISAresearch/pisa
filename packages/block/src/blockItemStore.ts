import { LevelUp, LevelUpChain } from "levelup";
import EncodingDown from "encoding-down";

const sub = require("subleveldown");

import { ApplicationError } from "@pisa-research/errors";
import { StartStopService, Lock, DbObject, DbObjectSerialiser, PlainObjectOrSerialisable, DbObjectOrSerialisable, Logger } from "@pisa-research/utils";

import { IBlockStub, BlockAndAttached } from "./block";
import { AnchorState } from "./component";

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
    constructor(db: LevelUp<EncodingDown<string, DbObject>>, private readonly serialiser: DbObjectSerialiser, logger: Logger) {
        super("block-item-store", logger);
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
        // load all items from the db
        for await (const record of this.subDb.createReadStream()) {
            const { key, value } = (record as any) as { key: string; value: any };

            const i = key.indexOf(":");
            const height = Number.parseInt(key.substring(0, i));
            const memKey = key.substring(i + 1);

            const deserialised = this.serialiser.deserialise<DbObjectOrSerialisable>(value);
            this.setItem(height, memKey, deserialised);

            if (memKey.endsWith(`:${BlockItemStore.KEY_STATE}`)) {
                this.mHasAnyAnchorStates = true;
            }
        }

        this.logger.info({ code: "p_bis_start", itemsByHeightCount: this.itemsByHeight.size, itemsCount: this.items.size }, "Store started.");
    }
    protected async stopInternal() {
        this.logger.info({ code: "p_bis_stop", itemsByHeightCount: this.itemsByHeight.size, itemsCount: this.items.size }, "Store stopped.");
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
            this.logger.debug({ code: "p_bis_bchw", duration: Date.now() - beforeBatchWrite, length: this.mBatch.length }, "Batch written.");

            return callBackResult;
        } finally {
            this.mBatch = null;
            this.batchLock.release();
        }
    }
}
