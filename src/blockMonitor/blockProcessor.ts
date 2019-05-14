import { ethers } from "ethers";
import { StartStopService } from "../dataEntities";
import logger from "../logger";
import { BlockCache } from "./blockCache";
import { IBlockStub } from "./blockStub";

/**
 * Listens to the provider for new blocks, and updates `blockCache` with all blocks, making sure that each block
 * is added only after the parent is added, except for blocks at depth `blockCache.maxDepth`.
 */
export class BlockProcessor extends StartStopService {
    // Blocks that are ready to be added to the BlockCache as soon as possible
    private blocksToAdd: ethers.providers.Block[] = [];
    // Hashes of blocks that are already known but not downloaded yet
    private pendingHashes: Set<string> = new Set();

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
        this.processQueue = this.processQueue.bind(this);
    }

    protected startInternal(): void {
        this.provider.on("block", this.handleBlockEvent);
    }

    protected stopInternal(): void {
        this.provider.removeListener("block", this.handleBlockEvent);
    }

    private async handleBlockEvent(blockNumber: number) {
        const block = await this.provider.getBlock(blockNumber);
        this.lastBlockHashReceived = block.hash;
        if (this.blockCache.hasBlock(block.hash)) {
            // Emit the new head block, now that all its info is ready
            this.emit(BlockProcessor.NEW_HEAD_EVENT, block.number, block.hash);
        } else {
            this.enqueueBlock(block);
        }
    }

    private enqueueBlock(block: ethers.providers.Block) {
        // If we do not already know this block
        if (block.hash in this.blocksToAdd.map(b => b.hash)) return; // block already known
        if (this.blockCache.hasBlock(block.hash)) return;

        this.blocksToAdd.push(block);
        this.processQueue();
    }

    // Process the queue until there are no blocks that can be added.
    // Potentially O(n^2) for a queue of n in reverse order of addition.
    private processQueue() {
        let done = false;
        while (!done) {
            done = true; // Unless we remove a block from the queue, no point in retrying

            const nextBlocksToAdd: ethers.providers.Block[] = [];
            for (let block of this.blocksToAdd) {
                // It is possible to add if the parent is already added (or node is deep enough)
                if (this.blockCache.canAddBlock(block)) {
                    this.blockCache.addBlock(block);
                    if (block.hash === this.lastBlockHashReceived) {
                        // Emit the new head block, now that all its info is ready
                        this.emit(BlockProcessor.NEW_HEAD_EVENT, block.number, block.hash);
                    }
                    done = false; // as the queue changed, we repeat the processing once more
                } else {
                    // Put block in queue for the next iteration...
                    nextBlocksToAdd.push(block);
                    // ...as we need to add the parent block first (unless already pending)
                    if (!this.pendingHashes.has(block.parentHash)) {
                        this.pendingHashes.add(block.parentHash);

                        this.provider
                            .getBlock(block.parentHash)
                            .then(parentBlock => {
                                this.pendingHashes.delete(block.parentHash);
                                this.enqueueBlock(parentBlock);
                            })
                            .catch(doh => {
                                this.pendingHashes.delete(block.parentHash);
                                // Failing to fetch a parent block is not a disaster (will retry), but log it anyway, for now
                                logger.error(
                                    `${this.name}: Error while fetching block ${block.parentHash}. Will try again.`
                                );
                            });
                    }
                }
            }

            // Put back in queue all blocks that were not removed yet
            this.blocksToAdd = nextBlocksToAdd;
        }
    }
}
