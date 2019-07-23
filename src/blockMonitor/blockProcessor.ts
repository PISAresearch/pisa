import { ethers } from "ethers";
import { StartStopService, ApplicationError } from "../dataEntities";
import { ReadOnlyBlockCache, BlockCache } from "./blockCache";
import { IBlockStub } from "../dataEntities";
import { Block, TransactionHashes } from "../dataEntities/block";

type BlockFactory<T> = (provider: ethers.providers.Provider) => (blockNumberOrHash: number | string) => Promise<T>;

export const blockStubAndTxHashFactory = (provider: ethers.providers.Provider) => async (
    blockNumberOrHash: string | number
): Promise<IBlockStub & TransactionHashes> => {
    const block = await provider.getBlock(blockNumberOrHash);
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
    const block = await provider.getBlock(blockNumberOrHash, true);

    // We could filter out the logs that we are not interesting in order to save space
    // (e.g.: only keep the logs from the DataRegistry).
    const logs = await provider.getLogs({
        blockHash: block.hash
    });

    return {
        hash: block.hash,
        number: block.number,
        parentHash: block.parentHash,
        transactions: (block.transactions as any) as ethers.providers.TransactionResponse[],
        transactionHashes: ((block.transactions as any) as ethers.providers.TransactionResponse[]).map(t => t.hash!),
        logs
    };
};

/**
 * Listens to the provider for new blocks, and updates `blockCache` with all the blocks, making sure that each block
 * is added only after the parent is added, except for blocks at depth `blockCache.maxDepth`.
 * It generates a `NEW_HEAD_EVENT` every time a new block is received by the provider, but only after populating
 * the `blockCache` with the new block and its ancestors.
 */
export class BlockProcessor<T extends IBlockStub> extends StartStopService {
    // keeps track of the last block hash received, in order to correctly emit NEW_HEAD_EVENT; null on startup
    private lastBlockHashReceived: string | null;

    // for set of blocks currently emitted as head block
    private emittedBlocks: WeakSet<Readonly<T>> = new WeakSet();

    // keeps track of the latest known head received
    private headHash: string | null = null;

    private mBlockCache: BlockCache<T>;

    private getBlock: (blockNumberOrHash: string | number) => Promise<T>;

    /**
     * Returns the ReadOnlyBlockCache associated to this BlockProcessor.
     */
    public get blockCache(): ReadOnlyBlockCache<T> {
        return this.mBlockCache;
    }

    /**
     * Event emitted when a new block is mined and has been added to the BlockCache.
     * It is not guaranteed that no block is skipped, especially in case of reorgs.
     * Emits the block stub of the new head, and the previous emitted block in the ancestry of this block..
     */
    public static readonly NEW_HEAD_EVENT = "new_head";

    /**
     * Event emitted when a new block is mined that does not seem to be part of the chain the current head is part of.
     * It is emitted before the corresponding NEW_HEAD_EVENT.
     * Emits the hash of the common ancestor block (or null if the reorg is deeper than maxDepth), the hash of the current new head,
     * and the hash of the previous head block (null if never previously set).
     */
    public static readonly REORG_EVENT = "reorg";

    /**
     * Event that is emitted for all blocks that have not previously been observed. If
     * a block is the new head it will also be emitted via the NEW_HEAD_EVENT, however
     * NEW_BLOCK_EVENT is guaranteed to emit first. Since this event emits for all new
     * blocks it does not guarantee that an emitted block will be in the ancestry of the next
     * emitted NEW_HEAD_EVENT.
     */
    public static readonly NEW_BLOCK_EVENT = "new_block";

    constructor(
        private provider: ethers.providers.BaseProvider,
        blockFactory: BlockFactory<T>,
        blockCache: BlockCache<T>
    ) {
        super("block-processor");

        this.getBlock = blockFactory(provider);
        this.mBlockCache = blockCache;

        this.processBlockNumber = this.processBlockNumber.bind(this);
    }

    protected async startInternal(): Promise<void> {
        // Make sure the current head block is processed
        const initialBlockNumber = await this.provider.getBlockNumber();

        await this.processBlockNumber(initialBlockNumber);

        this.provider.on("block", this.processBlockNumber);
    }

    protected async stopInternal(): Promise<void> {
        this.provider.removeListener("block", this.processBlockNumber);
    }

    // Returns true if `blockHash` is the last blockHash that was received
    private isBlockHashLastReceived(blockHash: string) {
        return this.lastBlockHashReceived === blockHash;
    }

    // update the new headHash and emit the appropriate events
    private processNewHead(headBlock: Readonly<T>, commonAncestorBlock: T | null) {
        const oldHeadHash = this.headHash; // we need to remember the old head for proper Reorg event handling
        this.headHash = headBlock.hash;

        this.mBlockCache.setHead(headBlock.hash);

        // Emit the appropriate events, but only if the service is already started
        if (!commonAncestorBlock) {
            // reorg beyond the depth of the cache; no common ancestor found
            this.emit(BlockProcessor.REORG_EVENT, null, this.headHash, oldHeadHash);
        } else if (oldHeadHash !== commonAncestorBlock.hash) {
            // reorg with a known common ancestor in cache
            this.emit(BlockProcessor.REORG_EVENT, commonAncestorBlock.hash, this.headHash, oldHeadHash);
        }

        const nearestEmittedBlockInAncestry = this.blockCache.findAncestor(headBlock.hash, block =>
            this.emittedBlocks.has(block)
        );

        this.emit(BlockProcessor.NEW_HEAD_EVENT, headBlock, nearestEmittedBlockInAncestry);
        this.emittedBlocks.add(headBlock);
    }

    // Processes a new block, adding it to the cache and emitting the appropriate events
    // It is called for each new block received, but also at startup (during startInternal).
    private async processBlockNumber(blockNumber: number) {
        try {
            const observedBlock = await this.getBlock(blockNumber);

            this.lastBlockHashReceived = observedBlock.hash;

            const blocksToAdd = [observedBlock]; // blocks to add, in reverse order

            // fetch ancestors until one is found that can be added
            let curBlock = observedBlock;
            while (!this.blockCache.canAddBlock(curBlock)) {
                curBlock = await this.getBlock(curBlock.parentHash);
                blocksToAdd.push(curBlock);
            }
            blocksToAdd.reverse(); // add blocks from the oldest

            // Last block in cache in the same chain as the new head
            const commonAncestorBlock = !this.blockCache.hasBlock(blocksToAdd[0].parentHash)
                ? null
                : this.blockCache.getBlockStub(blocksToAdd[0].parentHash);

            // populate fetched blocks into cache, starting from the deepest
            for (const block of blocksToAdd) {
                this.mBlockCache.addBlock(block);

                // we've added this block and it's ancestors
                // to the cache, so we we're safe to inform subscribers
                this.emit(BlockProcessor.NEW_BLOCK_EVENT, block);
            }

            // is the observed block still the last block received (or the first block during startup)?
            if (this.isBlockHashLastReceived(observedBlock.hash)) {
                this.processNewHead(observedBlock, commonAncestorBlock);
            }
        } catch (doh) {
            const error = doh as Error;
            this.logger.error(`There was an error fetching blocks: ${error.message}`);
            this.logger.error(error.stack!);
        }
    }
}
