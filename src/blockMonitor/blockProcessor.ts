import { ethers } from "ethers";
import { StartStopService } from "../dataEntities";
import { BlockCache } from "./blockCache";
import { IBlockStub } from "./blockStub";

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

    protected startInternal(): void {
        this.provider.on("block", this.handleBlockEvent);
    }

    protected stopInternal(): void {
        this.provider.removeListener("block", this.handleBlockEvent);
    }

    private async getParentsNotInCache(block: ethers.providers.Block): Promise<ethers.providers.Block[]> {
        if (this.blockCache.canAddBlock(block)) {
            // this parent is in the cache - do nothing
            return [];
        } else {
            // this parent is not in the cache, find further parents also in this situation
            const parentBlock = await this.provider.getBlock(block.parentHash);
            return (await this.getParentsNotInCache(parentBlock)).concat(parentBlock);
        }
    }

    private async handleBlockEvent(blockNumber: number) {
        const observedBlock = await this.provider.getBlock(blockNumber);
        this.lastBlockHashReceived = observedBlock.hash;

        // populate block and parents in cache
        if (!this.blockCache.hasBlock(observedBlock.hash)) {
            (await this.getParentsNotInCache(observedBlock))
                .concat(observedBlock)
                .filter(b => !this.blockCache.hasBlock(b.hash))
                .forEach(b => this.blockCache.addBlock(b));
        }

        // is the observed block still the last block received?
        if (this.lastBlockHashReceived === observedBlock.hash) {
            this.emit(BlockProcessor.NEW_HEAD_EVENT, observedBlock.number, observedBlock.hash);
        }
    }
}
