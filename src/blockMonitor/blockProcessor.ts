import { ethers } from "ethers";
import { StartStopService } from "../dataEntities";
import { ReadOnlyBlockCache, BlockCache } from "./blockCache";
import { IBlockStub } from "../dataEntities";
import { Block, TransactionHashes } from "../dataEntities/block";

type BlockFactory<TBlock> = (
    provider: ethers.providers.Provider
) => (blockNumberOrHash: number | string) => Promise<TBlock | null>;

export const blockStubAndTxHashFactory = (provider: ethers.providers.Provider) => async (
    blockNumberOrHash: string | number
): Promise<IBlockStub & TransactionHashes | null> => {
    const block = await provider.getBlock(blockNumberOrHash);
    if (!block) {
        return null;
    }
    return {
        hash: block.hash,
        number: block.number,
        parentHash: block.parentHash,
        transactionHashes: block.transactions
    };
};

export const blockFactory = (provider: ethers.providers.Provider) => async (
    blockNumberOrHash: string | number
): Promise<Block | null> => {
    const block = await provider.getBlock(blockNumberOrHash, true);

    if (!block) {
        return null;
    }
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
export class BlockProcessor<TBlock extends IBlockStub> extends StartStopService {
    // keeps track of the last block hash received, in order to correctly emit NEW_HEAD_EVENT; null on startup
    private lastBlockHashReceived: string | null;

    // set of blocks currently emitted in a NEW_HEAD_EVENT
    private emittedBlockHeads: WeakSet<Readonly<TBlock>> = new WeakSet();

    private mBlockCache: BlockCache<TBlock>;

    // Returned in the constructor by blockProvider: obtains the block remotely
    private getBlockRemote: (blockNumberOrHash: string | number) => Promise<TBlock | null>;

    /**
     * Returns the ReadOnlyBlockCache associated to this BlockProcessor.
     */
    public get blockCache(): ReadOnlyBlockCache<TBlock> {
        return this.mBlockCache;
    }

    /**
     * Event emitted when a new block is mined and has been added to the BlockCache.
     * It is not guaranteed that no block is skipped, especially in case of reorgs.
     * Emits the block stub of the new head, and the previous emitted block in the ancestry of this block..
     */
    public static readonly NEW_HEAD_EVENT = "new_head";

    /**
     * Event that is emitted for each new blocks. It is emitted (in order from the lowest-height block) for each block
     * in the ancestry of the current blockchain head that is deeper than the last block in the ancestry that was emitted
     * in a previous NEW_HEAD_EVENT. The NEW_HEAD_EVENT for the latest head block is guaranteed to be emitted after all the
     * NEW_BLOCK_EVENTs in the ancestry have been emitted.
     * A NEW_BLOCK_EVENT might happen to be emitted multiple times for the same block in case of blokchain re-orgs.
     */
    public static readonly NEW_BLOCK_EVENT = "new_block";

    constructor(
        private provider: ethers.providers.BaseProvider,
        blockFactory: BlockFactory<TBlock>,
        blockCache: BlockCache<TBlock>
    ) {
        super("block-processor");

        this.getBlockRemote = blockFactory(provider);
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

    // updates the new head block in the cache and emits the appropriate events
    private processNewHead(headBlock: Readonly<TBlock>) {
        this.mBlockCache.setHead(headBlock.hash);

        // only emit events after it's started
        if (this.started) {
            const nearestEmittedHeadInAncestry = this.blockCache.findAncestor(headBlock.hash, block =>
                this.emittedBlockHeads.has(block)
            );

            const ancestry = [...this.blockCache.ancestry(headBlock.hash)].reverse();
            const firstBlockIndex = nearestEmittedHeadInAncestry
                ? ancestry.findIndex(block => block.parentHash === nearestEmittedHeadInAncestry.hash)
                : 0;
            const blocksToEmit = ancestry.slice(firstBlockIndex);

            // Emit all the blocks past the latest block in the ancestry that was emitted as head
            // In case of re-orgs, some blocks might be re-emitted multiple times.
            for (const block of blocksToEmit) {
                this.emit(BlockProcessor.NEW_BLOCK_EVENT, block);
            }

            // Emit the new head
            this.emit(BlockProcessor.NEW_HEAD_EVENT, headBlock, nearestEmittedHeadInAncestry);
            this.emittedBlockHeads.add(headBlock);
        }
    }

    // Checks if a block is already in the block cache; if not, requests it remotely.
    private async getBlock(blockHash: string) {
        if (this.blockCache.hasBlock(blockHash, true)) {
            return this.blockCache.getBlock(blockHash);
        } else {
            return this.getBlockRemote(blockHash);
        }
    }
    // Processes a new block, adding it to the cache and emitting the appropriate events
    // It is called for each new block received, but also at startup (during startInternal).
    private async processBlockNumber(blockNumber: number) {
        try {
            const observedBlock = await this.getBlockRemote(blockNumber);
            if (observedBlock == null) {
                // No recovery needed, will pick this block up a next new_head event
                this.logger.info(`Failed to retrieve block with number ${blockNumber}.`);
                return;
            }

            if (this.blockCache.hasBlock(observedBlock.hash, true)) {
                // We received a block that we already processed before. Ignore, but log that it happened
                this.logger.info(
                    `Received block #${blockNumber} with hash ${observedBlock.hash}, that was already known. Skipping.`
                );
                return;
            }

            this.lastBlockHashReceived = observedBlock.hash;

            // fetch ancestors until one is found that can be added
            let curBlock: Readonly<TBlock> | null = observedBlock;
            while (!this.mBlockCache.addBlock(curBlock)) {
                const lastHash: string = curBlock.parentHash;
                curBlock = await this.getBlock(lastHash);

                if (!curBlock) {
                    this.logger.info(`Failed to retreive block with hash ${lastHash}.`);
                    return;
                }
            }

            // is the observed block still the last block received (or the first block during startup)?
            if (this.lastBlockHashReceived === observedBlock.hash) {
                this.processNewHead(observedBlock);
            }
        } catch (doh) {
            this.logger.error(doh);
        }
    }
}
