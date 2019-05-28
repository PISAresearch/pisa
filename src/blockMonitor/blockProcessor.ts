import { ethers } from "ethers";
import { StartStopService } from "../dataEntities";
import { BlockCache } from "./blockCache";
import { IBlockStub } from "./blockStub";
import logger from "../logger";

/**
 * Listens to the provider for new blocks, and updates `blockCache` with all the blocks, making sure that each block
 * is added only after the parent is added, except for blocks at depth `blockCache.maxDepth`.
 * It generates a `NEW_HEAD_EVENT` every time a new block is received by the provider, but only after populating
 * the `blockCache` with the new block and its ancestors.
 */
export class BlockProcessor extends StartStopService {
    private lastBlockHashReceived: string;

    public get head(): IBlockStub | null {
        return this.blockCache.getBlockStub(this.lastBlockHashReceived);
    }

    /**
     * Event emitted when a new block is mined and has been added to the BlockCache.
     * It is not guaranteed that no block is skipped, especially in case of reorgs.
     * Emits the block height and the block hash.
     */
    public static readonly NEW_HEAD_EVENT = "new_head";

    constructor(private provider: ethers.providers.BaseProvider, private blockCache: BlockCache) {
        super("Block processor");

        this.handleBlockEvent = this.handleBlockEvent.bind(this);
    }

    protected async startInternal(): Promise<void> {
        this.provider.on("block", this.handleBlockEvent);
    }

    protected async stopInternal(): Promise<void> {
        this.provider.removeListener("block", this.handleBlockEvent);
    }

    private async handleBlockEvent(blockNumber: number) {
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
                this.blockCache.addBlock(block);
            }

            // is the observed block still the last block received?
            if (this.lastBlockHashReceived === observedBlock.hash) {
                this.emit(BlockProcessor.NEW_HEAD_EVENT, observedBlock.number, observedBlock.hash);
            }
        } catch (doh) {
            const error = doh as Error;
            logger.error(`There was an error fetching blocks in ${this.name}: ${error.message}`);
            logger.error(error.stack!);
        }
    }
}
