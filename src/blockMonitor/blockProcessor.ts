import { ethers } from "ethers";
import { StartStopService } from "../dataEntities";
import { ReadOnlyBlockCache, BlockCache, BlockAddResult } from "./blockCache";
import { IBlockStub } from "../dataEntities";
import { Block, TransactionHashes } from "../dataEntities/block";
import { BlockFetchingError } from "../dataEntities/errors";

type BlockFactory<TBlock> = (
    provider: ethers.providers.Provider
) => (blockNumberOrHash: number | string) => Promise<TBlock>;

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
    try {
        const block = await provider.getBlock(blockNumberOrHash, includeTransactions);

        if (!block) throw new BlockFetchingError(`The provider returned null for block ${blockNumberOrHash}.`);

        return block;
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

    // Returned in the constructor by blockProvider: obtains the block remotely (or throws an exception on failure)
    private getBlockRemote: (blockNumberOrHash: string | number) => Promise<TBlock>;

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
            // Go through the ancestry, add any block that up until (but excluding) the last block
            // we emitted as head. If we never find a last emitted block, we emit all the ancestors in cache
            let nearestEmittedHeadInAncestry: Readonly<TBlock> | null = null;
            const blocksToEmit = [];
            for (const block of this.blockCache.ancestry(headBlock.hash)) {
                if (this.emittedBlockHeads.has(block)) {
                    nearestEmittedHeadInAncestry = block;
                    break;
                } else {
                    blocksToEmit.unshift(block);
                }
            }

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
            return await this.getBlockRemote(blockHash);
        }
    }
    // Processes a new block, adding it to the cache and emitting the appropriate events
    // It is called for each new block received, but also at startup (during startInternal).
    private async processBlockNumber(blockNumber: number) {
        try {
            const observedBlock = await this.getBlockRemote(blockNumber);

            if (this.blockCache.hasBlock(observedBlock.hash, true)) {
                // We received a block that we already processed before. Ignore, but log that it happened
                this.logger.info(
                    `Received block #${blockNumber} with hash ${observedBlock.hash}, that was already known. Skipping.`
                );
                return;
            }

            this.lastBlockHashReceived = observedBlock.hash;

            // fetch ancestors and keep adding until one is found that is attached
            let curBlock: Readonly<TBlock> = observedBlock;
            let blockResult: BlockAddResult;
            const observedBlockResult = (blockResult = this.mBlockCache.addBlock(curBlock));

            while (
                blockResult === BlockAddResult.AddedDetached ||
                blockResult === BlockAddResult.NotAddedAlreadyExistedDetached
            ) {
                curBlock = await this.getBlock(curBlock.parentHash);
                blockResult = this.mBlockCache.addBlock(curBlock);
            }

            // is the observed block still the last block received (or the first block, during startup)?
            // and was the block added to the cache?
            if (
                this.lastBlockHashReceived === observedBlock.hash &&
                observedBlockResult !== BlockAddResult.NotAddedBlockNumberTooLow
            ) {
                this.processNewHead(observedBlock);
            }
        } catch (doh) {
            if (doh instanceof BlockFetchingError) this.logger.info(doh);
            else this.logger.error(doh);
        }
    }
}
