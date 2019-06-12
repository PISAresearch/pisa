import { ethers } from "ethers";
import { StartStopService, ApplicationError } from "../dataEntities";
import { ReadOnlyBlockCache, BlockCache } from "./blockCache";
import { IBlockStub } from "./blockStub";

/**
 * Listens to the provider for new blocks, and updates `blockCache` with all the blocks, making sure that each block
 * is added only after the parent is added, except for blocks at depth `blockCache.maxDepth`.
 * It generates a `NEW_HEAD_EVENT` every time a new block is received by the provider, but only after populating
 * the `blockCache` with the new block and its ancestors.
 */
export class BlockProcessor extends StartStopService {
    // keeps track of the last block hash received, in order to correctly emit NEW_HEAD_EVENT; null on startup
    private lastBlockHashReceived: string | null;

    // keeps track of the latest known head received
    private headHash: string | null = null;

    private mBlockCache: BlockCache;

    /**
     * Returns the ReadOnlyBlockCache associated to this BlockProcessor.
     */
    public get blockCache(): ReadOnlyBlockCache {
        return this.mBlockCache;
    }

    /**
     * Event emitted when a new block is mined and has been added to the BlockCache.
     * It is not guaranteed that no block is skipped, especially in case of reorgs.
     * Emits the block height and the block hash.
     */
    public static readonly NEW_HEAD_EVENT = "new_head";

    /**
     * Event emitted when a new block is mined that does not seem to be part of the chain the current head is part of.
     * It is emitted before the corresponding NEW_HEAD_EVENT.
     * Emits the hash of the common ancestor block (or null if the reorg is deeper than maxDepth), the hash of the current new head,
     * and the hash of the previous head block.
     */
    public static readonly REORG_EVENT = "reorg";

    /**
     * Returns the IBlockStub of the latest known head block.
     *
     * @throws ApplicationError if the block is not found in the cache. This should never happen, unless
     *         `head` is read before the service is started.
     */
    public get head(): IBlockStub {
        if (this.headHash == null) {
            throw new ApplicationError("head used before the BlockProcessor is initialized.");
        }

        const blockStub = this.blockCache.getBlockStub(this.headHash);
        if (!blockStub) {
            throw new ApplicationError(`Head block ${this.headHash} not found in the BlockCache, but should be there`);
        }
        return blockStub;
    }

    constructor(private provider: ethers.providers.BaseProvider, blockCache: BlockCache) {
        super("block-processor");

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

    // update the new headHash if needed, and emit the appropriate events
    private processNewHead(headBlock: ethers.providers.Block, commonAncestorBlock: IBlockStub | null) {
        const oldHeadHash = this.headHash; // we need to remember the old head for proper Reorg event handling
        this.headHash = headBlock.hash;

        // Emit the appropriate events, but only if the service is already started
        if (this.isBlockHashLastReceived(this.headHash) && this.started) {
            if (!commonAncestorBlock) {
                // reorg beyond the depth of the cache; no common ancestor found
                this.emit(BlockProcessor.REORG_EVENT, null, this.headHash, oldHeadHash);
            } else if (oldHeadHash !== commonAncestorBlock.hash) {
                // reorg with a known common ancestor in cache
                this.emit(BlockProcessor.REORG_EVENT, commonAncestorBlock.hash, this.headHash, oldHeadHash);
            }

            this.emit(BlockProcessor.NEW_HEAD_EVENT, headBlock.number, headBlock.hash);
        }
    }

    // Processes a new block, adding it to the cache and emitting the appropriate events
    // It is called for each new block received, but also at startup (during startInternal).
    private async processBlockNumber(blockNumber: number) {
        try {
            const observedBlock = await this.provider.getBlock(blockNumber);

            this.lastBlockHashReceived = observedBlock.hash;

            const blocksToAdd = [observedBlock]; // blocks to add, in reverse order

            // fetch ancestors until one is found that can be added
            let curBlock = observedBlock;
            while (!this.blockCache.canAddBlock(curBlock)) {
                curBlock = await this.provider.getBlock(curBlock.parentHash);
                blocksToAdd.push(curBlock);
            }
            blocksToAdd.reverse(); // add blocks from the oldest

            // Last block in cache in the same chain as the new head
            const commonAncestorBlock = this.blockCache.getBlockStub(blocksToAdd[0].parentHash);

            // populate fetched blocks into cache, starting from the deepest
            for (const block of blocksToAdd) {
                this.mBlockCache.addBlock(block);
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
