import { ethers } from "ethers";
import { StartStopService, ApplicationError } from "../dataEntities";
import { ReadOnlyBlockCache, BlockCache } from "./blockCache";
import { IBlockStub } from "./blockStub";
import { waitForEvent } from "../utils";

/**
 * Listens to the provider for new blocks, and updates `blockCache` with all the blocks, making sure that each block
 * is added only after the parent is added, except for blocks at depth `blockCache.maxDepth`.
 * It generates a `NEW_HEAD_EVENT` every time a new block is received by the provider, but only after populating
 * the `blockCache` with the new block and its ancestors.
 */
export class BlockProcessor extends StartStopService {
    // keeps track of the last block hash received, in order to correctly emit NEW_HEAD_EVENT
    private lastBlockHashReceived: string;

    // keeps track of the latest known head received
    private headHash: string;

    private mBlockCache: BlockCache;

    /**
     * Returns the ReadOnlyBlockCache associated to this BlockProcessor.
     */
    public get blockCache(): ReadOnlyBlockCache {
        return this.mBlockCache;
    }

    /**
     * Returns the IBlockStub of the latest known head block, or null if none is known yet
     */
    public get head(): IBlockStub {
        const blockStub = this.blockCache.getBlockStub(this.headHash);
        if (blockStub === null) {
            throw new ApplicationError(`Head block ${this.headHash} not found in the BlockCache, but should be there`);
        }
        return blockStub;
    }

    /**
     * Event emitted when a new block is mined and has been added to the BlockCache.
     * It is not guaranteed that no block is skipped, especially in case of reorgs.
     * Emits the block height and the block hash.
     */
    public static readonly NEW_HEAD_EVENT = "new_head";

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

            // populate fetched blocks into cache, starting from the deepest
            for (const block of blocksToAdd.reverse()) {
                this.mBlockCache.addBlock(block);
            }

            // is the observed block still the last block received?
            if (this.lastBlockHashReceived === observedBlock.hash) {
                this.headHash = observedBlock.hash;
                this.emit(BlockProcessor.NEW_HEAD_EVENT, observedBlock.number, observedBlock.hash);
            }
        } catch (doh) {
            const error = doh as Error;
            this.logger.error(`There was an error fetching blocks: ${error.message}`);
            this.logger.error(error.stack!);
        }
    }
}
