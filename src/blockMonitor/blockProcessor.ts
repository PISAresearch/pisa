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

        /* NB must be wrapped in asProtectedMethod even though the method is not run at this stage. (see silimar in MultiResponder) */
        this.processBlockNumber =  this.asProtectedMethod(this.processBlockNumber).bind(this);
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

    // updates the new head block in the cache and emits the appropriate events
    private processNewHead(headBlock: Readonly<T>) {
        this.mBlockCache.setHead(headBlock.hash);
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

            // populate fetched blocks into cache, starting from the deepest
            for (const block of blocksToAdd) {
                this.mBlockCache.addBlock(block);

                // we've added this block and its ancestors
                // to the cache, so we we're safe to inform subscribers
                this.emit(BlockProcessor.NEW_BLOCK_EVENT, block);
            }

            // is the observed block still the last block received (or the first block during startup)?
            if (this.isBlockHashLastReceived(observedBlock.hash)) {
                this.processNewHead(observedBlock);
            }
        } catch (doh) {
            this.logger.error(doh);
        }
    }
}
