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
     * Event that is emitted for all blocks that have not previously been observed. If
     * a block is the new head it will also be emitted via the NEW_HEAD_EVENT, however
     * NEW_BLOCK_EVENT is guaranteed to emit first. Since this event emits for all new
     * blocks it does not guarantee that an emitted block will be in the ancestry of the next
     * emitted NEW_HEAD_EVENT.
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

    // Returns true if `blockHash` is the last blockHash that was received
    private isBlockHashLastReceived(blockHash: string) {
        return this.lastBlockHashReceived === blockHash;
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

            // TODO:227: this is different than before, as a NEW_BLOCK_EVENT will happen multiple times for the same block in case of multiple reorgs.
            //           Could restore a behavior similar to the old one by keeping track of all the emitted blocks (rather than only the heads) in a WeakMap.
            for (const block of blocksToEmit) {
                this.emit(BlockProcessor.NEW_BLOCK_EVENT, block);
            }

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
                // TODO:227: what to do if block is null? Is failing silently ok?
                return;
            }

            this.lastBlockHashReceived = observedBlock.hash;

            // fetch ancestors until one is found that can be added
            let curBlock: Readonly<TBlock> | null = observedBlock;
            while (!this.mBlockCache.addBlock(curBlock!)) {
                curBlock = await this.getBlock(curBlock.parentHash);

                if (!curBlock) {
                    // TODO:227: how to recover if block returns null here? Fail silently?
                    break;
                }
            }

            // is the observed block still the last block received (or the first block during startup)?
            if (this.isBlockHashLastReceived(observedBlock.hash)) {
                this.processNewHead(observedBlock);
            }
        } catch (doh) {
            const error = doh as Error;
            this.logger.error(`There was an error fetching blocks: ${error.message}`);
            this.logger.error(error.stack!);
        }
    }
}
