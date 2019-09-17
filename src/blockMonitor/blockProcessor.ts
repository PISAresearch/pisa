import { ethers } from "ethers";
import { StartStopService } from "../dataEntities";
import { ReadOnlyBlockCache, BlockCache, BlockAddResult } from "./blockCache";
import { IBlockStub } from "../dataEntities";
import { Block, TransactionHashes, BlockItemStore } from "../dataEntities/block";
import { BlockFetchingError, ApplicationError } from "../dataEntities/errors";
import { LevelUp } from "levelup";
import EncodingDown from "encoding-down";
import { createNamedLogger, Logger } from "../logger";
import { BlockEvent } from "../utils/event";
import { Lock } from "../utils/lock";
const sub = require("subleveldown");

type BlockFactory<TBlock> = (provider: ethers.providers.Provider) => (blockNumberOrHash: number | string) => Promise<TBlock>;

/**
 * Listener for the event emitted when a new block is mined and has been added to the BlockCache.
 * It is not guaranteed that no block is skipped, especially in case of reorgs.
 * Emits the block stub of the new head, and the previous emitted block in the ancestry of this block..
 */
export type NewHeadListener<TBlock> = (head: Readonly<TBlock>) => Promise<void>;

// Convenience function to wrap the provider's getBlock function with some error handling logic.
// The provider can occasionally fail (by returning null or throwing an error), observed when using Infura.
// (see https://github.com/PISAresearch/pisa/issues/227)
// This function throws BlockFetchingError for errors that are known to happen and considered not serious
// (that is, the correct recovery for the BlockProcessor is to give up and try again on the next block).
// Any other unexpected error is not handled here.
async function getBlockFromProvider(
    provider: ethers.providers.Provider,
    blockNumberOrHash: string | number,
    includeTransactions: boolean = false
) {
    const block = await provider.getBlock(blockNumberOrHash, includeTransactions);

    if (!block) throw new BlockFetchingError(`The provider returned null for block ${blockNumberOrHash}.`);

    return block;
}

export const blockStubAndTxHashFactory = (provider: ethers.providers.Provider) => async (
    blockNumberOrHash: string | number
): Promise<IBlockStub & TransactionHashes> => {
    const block = await getBlockFromProvider(provider, blockNumberOrHash);

    return {
        hash: block.hash,
        number: block.number,
        parentHash: block.parentHash,
        transactionHashes: block.transactions
    };
};

export const blockFactory = (provider: ethers.providers.Provider) => async (
    blockNumberOrHash: string | number
): Promise<Block> => {
    try {
        const block = await getBlockFromProvider(provider, blockNumberOrHash, true);

        // We could filter out the logs that we are not interesting in order to save space
        // (e.g.: only keep the logs from the DataRegistry).
        const logs = await provider.getLogs({
            blockHash: block.hash
        });

        const transactions = (block.transactions as any) as ethers.providers.TransactionResponse[];
        for (const tx of transactions) {
            // we should use chain id, but for some reason chain id is not present in transactions from ethersjs
            // therefore we fallback to network id when chain id is not present
            if (tx.chainId == undefined) tx.chainId = (tx as any).networkId;
        }

        return {
            hash: block.hash,
            number: block.number,
            parentHash: block.parentHash,
            transactions: transactions,
            transactionHashes: ((block.transactions as any) as ethers.providers.TransactionResponse[]).map(
                t => t.hash!
            ),
            logs
        };
    } catch (doh) {
        // On infura the provider occasionally returns an error with message 'unknown block'.
        // See https://github.com/PISAresearch/pisa/issues/227
        // We rethrow this as BlockFetchingError, and rethrow any other error as-is.
        if (doh instanceof Error && doh.message === "unknown block") {
            throw new BlockFetchingError(`Error while fetching block ${blockNumberOrHash} from the provider.`, doh);
        } else {
            throw doh;
        }
    }
};

export class BlockProcessorStore {
    private readonly subDb: LevelUp<EncodingDown<string, any>>;
    constructor(db: LevelUp<EncodingDown<string, any>>) {
        this.subDb = sub(db, `block-processor`, { valueEncoding: "json" });
    }

    async getLatestHeadNumber() {
        try {
            const headObj = await this.subDb.get("head");
            return (headObj as { head: number }).head;
        } catch (doh) {
            // Rethrow any error, except for "key not found", which is expected
            if (doh.type === "NotFoundError") return undefined;

            throw doh;
        }
    }
    async setLatestHeadNumber(value: number) {
        await this.subDb.put("head", { head: value });
    }
}

/**
 * Listens to the provider for new blocks, and updates `blockCache` with all the blocks, making sure that each block
 * is added only after the parent is added, except for blocks at depth `blockCache.maxDepth`.
 * It generates a "new head" event every time a new block is received by the provider, but only after populating
 * the `blockCache` with the new block and its ancestors (thus, the BlockCache's "new block" event is always emitted for a block
 * and its ancestors before the corresponding "new head" event).
 */
export class BlockProcessor<TBlock extends IBlockStub> extends StartStopService {
    // keeps track of the last block hash received, in order to correctly emit NEW_HEAD_EVENT; null on startup
    private lastBlockHashReceived: string | null;

    private mBlockCache: BlockCache<TBlock>;

    public newHead = new BlockEvent<TBlock>();

    // Returned in the constructor by blockProvider: obtains the block remotely (or throws an exception on failure)
    private getBlockRemote: (blockNumberOrHash: string | number) => Promise<TBlock>;

    private blockItemStoreLock = new Lock();

    /**
     * Returns the ReadOnlyBlockCache associated to this BlockProcessor.
     */
    public get blockCache(): ReadOnlyBlockCache<TBlock> {
        return this.mBlockCache;
    }

    constructor(
        private provider: ethers.providers.BaseProvider,
        blockFactory: BlockFactory<TBlock>,
        blockCache: BlockCache<TBlock>,
        private readonly blockItemStore: BlockItemStore<TBlock>,
        private readonly store: BlockProcessorStore
    ) {
        super("block-processor");

        this.getBlockRemote = blockFactory(provider);
        this.mBlockCache = blockCache;

        this.processBlockNumber = this.processBlockNumber.bind(this);
    }

    protected async startInternal(): Promise<void> {
        // Make sure the current head block is processed
        const currentHead = (await this.store.getLatestHeadNumber()) || (await this.provider.getBlockNumber());
        await this.processBlockNumber(currentHead);
        this.provider.on("block", this.processBlockNumber);
    }

    protected async stopInternal(): Promise<void> {
        this.provider.removeListener("block", this.processBlockNumber);
    }

    // emits the appropriate events and updates the new head block in the store
    private async processNewHead(headBlock: Readonly<TBlock>) {
        try {
            await this.blockItemStoreLock.acquire();
            await this.blockItemStore.withBatch(async () => {
                this.mBlockCache.setHead(headBlock.hash);

                // only emit new head events after it is started
                if (this.started) await this.newHead.emit(headBlock);
            });

            await this.store.setLatestHeadNumber(headBlock.number);
        } catch (doh) {
            this.logger.error(doh);
        } finally {
            this.blockItemStoreLock.release();
        }
    }

    // Checks if a block is already in the block cache; if not, requests it remotely.
    private async getBlock(blockHash: string) {
        if (this.blockCache.hasBlock(blockHash, true)) {
            return this.blockCache.getBlock(blockHash);
        } else {
            return await this.getBlockRemote(blockHash);
        }
    }

    // Processes a new block, adding it to the cache and emitting the appropriate events
    // It is called for each new block received, but also at startup (during startInternal).
    private async processBlockNumber(blockNumber: number) {
        try {
            let processingBlockNumber: number; // the block processed in this batch; will be equal to blockNumber on the last batch
            let observedBlock: TBlock; // the block the provider returned for height processingBlockNumber
            do {
                // As the block hash we receive when we query the provider by block number is not guaranteed to be the same on multiple calls
                // (as there could have been a reorg, or the query might be processed by a different node), we only do this query once to get a block hash,
                // then we proceed backwards using the parentHash to get enough ancestors until we can attach to the BlockCache.
                // We split the processing in batches of at most blockCache.maxDepth blocks, in order to avoid keeping a very large number of blocks in memory.
                // It should be only one batch under normal circumstances, but we might fall behing more, for example, if Pisa crashed and there was some downtime.

                processingBlockNumber = this.mBlockCache.isEmpty
                    ? blockNumber // if cache is empty, process just the current block
                    : Math.min(blockNumber, this.blockCache.head.number + this.blockCache.maxDepth); // otherwise, download a batch of blocks (up to blockNumber)

                observedBlock = await this.getBlockRemote(processingBlockNumber);
                if (processingBlockNumber === blockNumber) this.lastBlockHashReceived = observedBlock.hash;

                // starting from observedBlock, add to the cache and download the parent, until the return value signals that block is attached
                let curBlock = observedBlock;
                while (true) {
                    let addResult: BlockAddResult | null = null;

                    try {
                        await this.blockItemStoreLock.acquire();
                        await this.blockItemStore.withBatch(async () => {
                            addResult = await this.mBlockCache.addBlock(curBlock);
                        });
                    } finally {
                        this.blockItemStoreLock.release();
                    }

                    if (addResult !== BlockAddResult.AddedDetached && addResult !== BlockAddResult.NotAddedAlreadyExistedDetached)
                        break;

                    curBlock = await this.getBlock(curBlock.parentHash);
                }
            } while (processingBlockNumber !== blockNumber);

            // is the observed block still the last block received (or the first block, during startup)?
            // and was the block added to the cache?
            if (this.lastBlockHashReceived === observedBlock.hash) {
                await this.processNewHead(observedBlock);
            }
        } catch (doh) {
            if (doh instanceof BlockFetchingError) this.logger.info(doh);
            else this.logger.error(doh);
        }
    }
}
