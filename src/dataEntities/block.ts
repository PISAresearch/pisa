import { ethers } from "ethers";
import { BigNumber } from "ethers/utils";
import { ArgumentError } from "./errors";
import { LevelUp } from "levelup";
import EncodingDown from "encoding-down";
import { StartStopService } from "./startStop";
import { AnchorState } from "../blockMonitor/component";
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

export type BlockAndAttached<TBlock extends IBlockStub> = {
    block: TBlock;
    attached: boolean;
};

/**
 * This store is a support structure for the block cache and all the related components that need to store blocks and other data that
 * is attached to those blocks, but pruning data that is too old. All the items are stored by block number and block hash, and can be
 * retrieved by block hash only. Moreover, there are methods to retrieve and/or delete all the blocks (and any attached info) at a certain height.
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

    /** Stores the anchor state of the nearest ancestor (including the block itself)s
     * that was emitted as a "new head"; indexed by component. */
    private static KEY_PREV_EMITTED_STATE = "prevEmittedState";

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

    // should only be used internally, kept public for testing
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

    // Type safe methods to store blocks
    public block = {
        get: (blockHash: string): TBlock =>
            this.getItem(blockHash, BlockItemStore.KEY_BLOCK), // prettier-ignore
        set: (blockHeight: number, blockHash: string, block: TBlock) =>
            this.putBlockItem(blockHeight, blockHash, BlockItemStore.KEY_BLOCK, block) // prettier-ignore
    };

    // Type safe methods to store the "attached" boolean for each block (used in the BlockCache)
    public attached = {
        get: (blockHash: string): boolean =>
            this.getItem(blockHash, BlockItemStore.KEY_ATTACHED), // prettier-ignore
        set: (blockHeight: number, blockHash: string, attached: boolean) =>
            this.putBlockItem(blockHeight, blockHash, BlockItemStore.KEY_ATTACHED, attached) // prettier-ignore
    };

    // Type safe methods to store the anchor state for each block, indexed by component (used in the BlockchainMachine)
    public anchorState = {
        get: <TAnchorState>(componentName: string, blockHash: string): TAnchorState =>
            this.getItem(blockHash, `${componentName}:${BlockItemStore.KEY_STATE}`), // prettier-ignore
        set: (componentName: string, blockHeight: number, blockHash: string, newState: AnchorState) =>
            this.putBlockItem(blockHeight, blockHash, `${componentName}:${BlockItemStore.KEY_STATE}`, newState)
    };

    // Type safe methods to store the latest emitted anchor state for each block, indexed by component (used in the BlockchainMachine)
    public prevEmittedAnchorState = {
        get: <TAnchorState>(componentName: string, blockHash: string): TAnchorState =>
            this.getItem(blockHash, `${componentName}:${BlockItemStore.KEY_PREV_EMITTED_STATE}`), // prettier-ignore
        set: (componentName: string, blockHeight: number, blockHash: string, newPrevEmittedState: AnchorState) =>
            this.putBlockItem(blockHeight, blockHash, `${componentName}:${BlockItemStore.KEY_PREV_EMITTED_STATE}`, newPrevEmittedState)
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
                const block = this.block.get(blockHash)
                const attached = this.attached.get(blockHash)
                blocks.push({ block, attached });
            }
        }
        return blocks;
    }

    /** Delete all blocks and other indexed items for that height. */
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
