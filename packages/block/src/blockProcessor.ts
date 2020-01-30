import { ethers } from "ethers";
import { StartStopService, Lock } from "@pisa-research/utils";
import { ReadOnlyBlockCache, BlockCache, BlockAddResult } from "./blockCache";
import { IBlockStub, Block, TransactionHashes } from "./block";
import { BlockItemStore } from "./blockItemStore";
import { BlockFetchingError, ApplicationError, UnreachableCaseError } from "@pisa-research/errors";
import { LevelUp } from "levelup";
import EncodingDown from "encoding-down";
import { BlockEvent } from "./event";
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
async function getBlockFromProvider(provider: ethers.providers.Provider, blockNumberOrHash: string | number, includeTransactions: boolean = false) {
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

export const blockFactory = (provider: ethers.providers.Provider) => async (blockNumberOrHash: string | number): Promise<Block> => {
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
            transactionHashes: ((block.transactions as any) as ethers.providers.TransactionResponse[]).map(t => t.hash!),
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
    private mBlockCache: BlockCache<TBlock>;

    /**
     * Event generated when a new block is emitted that is currently considered the tip of the blockchain.
     * It is guaranteed that the `newBlock` for the same block is emitted before the corresponding `newHead` event is,
     * but it is not guaranteed that any specific block will be emitted in a `newHead` event.
     * Only emitted after the service is started.
     */
    public newHead = new BlockEvent<TBlock>();

    /**
     * Event emitted when a new block is known and added to the BlockCache. It is not guaranteed that the emitted block is the head
     * of the blockchain, nor that it is part of the current best blockchain. It is guauranteed that blocks are emitted in order (that is,
     * the parent was always emitted before the current block), except when the `BlockProcessor` is initialized for the first time with a fresh
     * `BlockProcessorStore`.
     * Only emitted after the service is started.
     */
    public newBlock = new BlockEvent<TBlock>();

    // Returned in the constructor by blockProvider: obtains the block remotely (or throws an exception on failure)
    private getBlockRemote: (blockNumberOrHash: string | number) => Promise<TBlock>;

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
        this.processNewBlock = this.processNewBlock.bind(this);
    }

    protected async startInternal(): Promise<void> {
        // Make sure the current head block is processed
        const currentHead = (await this.store.getLatestHeadNumber()) || (await this.provider.getBlockNumber());
        await this.processBlockNumber(currentHead);
        this.provider.on("block", this.processBlockNumber);

        // After startup, `newBlock` events of the BlockCache are proxied
        this.mBlockCache.newBlock.addListener(this.processNewBlock);

        this.logger.info({ currentHeadNumber: currentHead }, "Blockprocessor started.");
    }

    protected async stopInternal(): Promise<void> {
        this.mBlockCache.newBlock.removeListener(this.processNewBlock);
        this.provider.removeListener("block", this.processBlockNumber);
    }

    // proxies the newBlock event from the cache from the moment startup is complete
    private async processNewBlock(block: TBlock) {
        if (!this.started) throw new ApplicationError("The BlockProcessor should not receive newBlock events before startup is complete."); // prettier-ignore

        await this.newBlock.emit(block);
    }

    // emits the appropriate events and updates the new head block in the store
    private async processNewHead(headBlock: Readonly<TBlock>) {
        try {
            this.mBlockCache.setHead(headBlock.hash);

            // only emit new head events after it is started
            if (this.started) {
                await this.blockItemStore.withBatch(
                    // All the writes in the BlockItemStore that happen in any of the components are executed as part of the same batch.
                    // Thus, they are either all written to the db, or none of them is.
                    // As other objects (most notably the BlockchainMachine) are listenin to "new head" events and writing to the BlockItemStore,
                    // we cannot be sure that the intermediate states are consistent without batching all the writes together.
                    async () => await this.newHead.emit(headBlock)
                );
            }

            // We update the latest head number in the BlockProcessorStore only after successfully updating everything in the components,
            // Thus, in case of failure above, we do not update the head number for the block processor in order to repeat the processing
            // upon startup.
            await this.store.setLatestHeadNumber(headBlock.number);
        } catch (doh) {
            this.logger.error(doh);
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

    private async addBlockToCache(block: TBlock) {
        return await this.blockItemStore.withBatch(async () => {
            // We execute all the writes in the BlockCache and everything that listens to new blocks and writes to
            // the BlockItemStore, like the BlockchainMachine) in the same batch. Thus, they either all succeed or
            // they are not written to disk.
            // Note that adding a block might cause some other blocks that were detached in the BlockCache
            // to become attached, and a "new block" event will be emitted for each of them.
            // Not batching these writes could cause partial updates to be saved to storage, like blocks staying
            // detached in the BlockCache even if they should become attached, or blocks already emitted in the
            // BlockCache while some consequences of the same events are lost.
            return await this.mBlockCache.addBlock(block);
        });
    }

    private processorLock = new Lock();

    // Processes a new block, adding it to the cache and emitting the appropriate events
    // It is called for each new block received, but also at startup (during startInternal).
    private async processBlockNumber(observedBlockNumber: number) {
        try {
            await this.processorLock.acquire();

            let shouldProcessHead; // whether to process a new head
            let processingBlockNumber: number = this.mBlockCache.isEmpty ? observedBlockNumber : this.blockCache.head.number; // initialise the processing number
            let processingBlock: TBlock; // the block the provider returned for height processingBlockNumber
            do {
                // As the block hash we receive when we query the provider by block number is not guaranteed to be the same on multiple calls
                // (as there could have been a reorg, or the query might be processed by a different node), we only do this query once to get a block hash,
                // then we proceed backwards using the parentHash to get enough ancestors until we can attach to the BlockCache.
                // We split the processing in batches of at most blockCache.maxDepth blocks, in order to avoid keeping a very large number of blocks in memory.
                // It should be only one batch under normal circumstances, but we might fall behing more, for example, if Pisa crashed and there was some downtime.
                
                // the block processed in this batch; will be equal to blockNumber on the last batch
                processingBlockNumber = Math.min(processingBlockNumber + this.blockCache.maxDepth, observedBlockNumber);
                processingBlock = await this.getBlockRemote(processingBlockNumber);

                // starting from observedBlock, add to the cache and download the parent, until the return value signals that block is attached
                let curBlock = processingBlock;
                while (true) {
                    const addResult = await this.addBlockToCache(curBlock);
                    let continueBlockFetching = false;
                    if (curBlock.number % 100 === 0) this.logger.info({ number: curBlock.number, hash: curBlock.hash }, "Synchronised block.");

                    switch (addResult) {
                        case BlockAddResult.Added: {
                            // added a block to the cache, this means its parent must exist
                            // in the cache. Adding a block here means that we need to emit a new
                            // head.
                            shouldProcessHead = true;
                            continueBlockFetching = false;
                            break;
                        }
                        case BlockAddResult.AddedDetached: {
                            // added, but we havent reached the bottom of the stack
                            // keep looking for more
                            shouldProcessHead = false;
                            continueBlockFetching = true;
                            break;
                        }
                        case BlockAddResult.NotAddedAlreadyExisted: {
                            // the block already existed, we dont need to look for
                            // new blocks, but we also dont need to set a new head
                            shouldProcessHead = false;
                            continueBlockFetching = false;
                            break;
                        }
                        case BlockAddResult.NotAddedAlreadyExistedDetached: {
                            // the block already existed in a detached state
                            // lets keep looking until we can attach lower blocks
                            shouldProcessHead = false;
                            continueBlockFetching = true;
                            break;
                        }
                        case BlockAddResult.NotAddedBlockNumberTooLow: {
                            // we couldnt add because the block was out of the bounds
                            // of the cache, we cant looking below this, but we also
                            // cant set a new head
                            shouldProcessHead = false;
                            continueBlockFetching = false;
                            break;
                        }
                        default:
                            throw new UnreachableCaseError(addResult, "Missing case for addResult.");
                    }

                    if (!continueBlockFetching) break;

                    curBlock = await this.getBlock(curBlock.parentHash);
                }
            } while (processingBlockNumber !== observedBlockNumber);

            // is the observed block still the last block received (or the first block, during startup)?
            // and was the block added to the cache?
            if (shouldProcessHead || this.mBlockCache.isEmpty) {
                await this.processNewHead(processingBlock);
            }
        } catch (doh) {
            if (doh instanceof BlockFetchingError) this.logger.info(doh);
            else this.logger.error(doh);
        } finally {
            await this.processorLock.release();
        }
    }
}
