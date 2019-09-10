import { ethers } from "ethers";
import { BigNumber } from "ethers/utils";
import { ArgumentError } from "./errors";
import { LevelUp } from "levelup";
import EncodingDown from "encoding-down";
import { StartStopService } from "./startStop";
const sub = require("subleveldown");

export interface IBlockStub {
    hash: string;
    number: number;
    parentHash: string;
}

export interface Logs {
    logs: ethers.providers.Log[];
}

/**
 * Returns true the `block` contains a log that matches `filter`, false otherwise.
 */
export function hasLogMatchingEventFilter(block: Logs, filter: ethers.EventFilter): boolean {
    if (!filter.address) throw new ArgumentError("The filter must provide an address");
    if (!filter.topics) throw new ArgumentError("The filter must provide the topics");

    return block.logs.some(
        log =>
            log.address.toLowerCase() === filter.address!.toLowerCase() &&
            filter.topics!.every((topic, idx) => log.topics[idx].toLowerCase() === topic.toLowerCase())
    );
}

export interface TransactionHashes {
    transactionHashes: string[];
}

export interface Transactions {
    transactions: ethers.providers.TransactionResponse[];
}

export interface TransactionStub {
    blockNumber?: number;
    nonce: number;
    to?: string;
    from: string;
    chainId: number;
    data: string;
    value: BigNumber;
    gasLimit: BigNumber;
}

export interface ResponderBlock extends IBlockStub {
    transactions: TransactionStub[];
}

export interface Block extends IBlockStub, Logs, Transactions, TransactionHashes {}

export class BlockItemStore<TBlock extends IBlockStub> extends StartStopService {
    // Keys used by the BlockCache
    /** Stores the content of the block. */
    public static KEY_BLOCK = "block";
    /** True if the block was attached to the BlockCache; otherwise the block is still 'detached'. */
    public static KEY_ATTACHED = "attached";

    // Keys used by the BlockchainMachine
    /** Stores the anchor state computed for this block; indexed by component. */
    public static KEY_STATE = "state";

    /** Stores the anchor state of the nearest ancestor (including the block itself)s
     * that was emitted as a "new head"; indexed by component. */
    public static KEY_PREVEMITTEDSTATE = "prevEmittedState";

    private readonly subDb: LevelUp<EncodingDown<string, any>>;
    constructor(db: LevelUp<EncodingDown<string, any>>) {
        super("block-item-store");
        this.subDb = sub(db, `block-item-store`, { valueEncoding: "json" });
    }

    private itemsByHeight: Map<number, Set<string>> = new Map();
    private items: Map<string, any> = new Map();

    protected async startInternal() {
        // load all items from the db
        for await (const record of this.subDb.createReadStream()) {
            const { key, value } = (record as any) as { key: string; value: any };

            const i = key.indexOf(":");
            const height = Number.parseInt(key.substring(0, i));
            const memKey = key.substring(i + 1);

            const itemsAtHeight = this.itemsByHeight.get(height);
            if (itemsAtHeight) itemsAtHeight.add(memKey);
            else this.itemsByHeight.set(height, new Set([memKey]));
            this.items.set(memKey, value);
        }
    }
    protected async stopInternal() {}

    public async putBlockItem(blockHeight: number, blockHash: string, itemKey: string, item: any) {
        const memKey = `${blockHash}:${itemKey}`;
        const dbKey = `${blockHeight}:${memKey}`;

        const itemsAtHeight = this.itemsByHeight.get(blockHeight);
        if (itemsAtHeight) itemsAtHeight.add(memKey);
        else this.itemsByHeight.set(blockHeight, new Set([memKey]));
        this.items.set(memKey, item);

        await this.subDb.put(dbKey, item);
    }

    /**
     * Gets the item with key `itemKey` for block `blockHash`.
     * Returns `undefined` if a key is not present.
     **/
    public getItem(blockHash: string, itemKey: string) {
        const key = `${blockHash}:${itemKey}`;
        return this.items.get(key);
    }

    // This behavior is too specific for the needs of the BlockCache; should be refactored
    // returns the items stored under the key BlockItemStore.KEY_BLOCK for the specific height, and wether they are
    public getBlocksAtHeight(height: number): (TBlock & { attached: boolean })[] {
        const itemsAtHeight = this.itemsByHeight.get(height) || new Set();
        // collect blocks and attachment info

        const blocks: (TBlock & { attached: boolean })[] = [];

        for (const item of itemsAtHeight) {
            // check if it is the actual block
            if (item.endsWith(`:${BlockItemStore.KEY_BLOCK}`)) {
                const itemKey = item.slice(0, -`:${BlockItemStore.KEY_BLOCK}`.length);
                const block = this.items.get(item) as TBlock;
                const attached = this.items.get(itemKey + `:${BlockItemStore.KEY_ATTACHED}`) as boolean;
                blocks.push({ ...block, attached: attached });
            }
        }
        return blocks;
    }

    // delete all blocks and supplements
    public async deleteItemsAtHeight(height: number) {
        const itemsAtHeight = this.itemsByHeight.get(height);
        if (itemsAtHeight) {
            this.itemsByHeight.delete(height);
            let batch = this.subDb.batch();
            for (const key of itemsAtHeight) {
                const dbKey = `${height}:${key}`;
                batch.del(dbKey);
                this.items.delete(key);
            }
            await batch.write();
        }
    }
}
