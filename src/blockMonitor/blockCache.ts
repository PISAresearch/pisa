import { ApplicationError, ArgumentError } from "../dataEntities";
import { IBlockStub, TransactionHashes, BlockItemStore } from "../dataEntities/block";
import { Lock } from "../utils/lock";
import { BlockEvent } from "../utils/event";

// Possible return values of addBlock
export enum BlockAddResult {
    Added = 1,
    AddedDetached = 2,
    NotAddedBlockNumberTooLow = 3,
    NotAddedAlreadyExisted = 4,
    NotAddedAlreadyExistedDetached = 5
}

/**
 * Listener for the event that is emitted for each new blocks that is attached to the cache.
 */
export type NewBlockListener<TBlock> = (block: TBlock) => Promise<void>;

/**
 * This interface represents the read-only view of a BlockCache.
 */
export interface ReadOnlyBlockCache<TBlock extends IBlockStub> {
    NewBlock: BlockEvent<TBlock>;
    readonly maxDepth: number;
    readonly maxHeight: number;
    readonly minHeight: number;
    getBlock(blockHash: string): Readonly<TBlock>;
    hasBlock(blockHash: string, includeDetached?: boolean): boolean;
    ancestry(initialBlockHash: string): IterableIterator<Readonly<TBlock>>;
    findAncestor(initialBlockHash: string, predicate: (block: Readonly<TBlock>) => boolean, minHeight?: number): Readonly<TBlock> | null;
    getOldestAncestorInCache(blockHash: string): TBlock;
    head: TBlock;
}

/**
 * Utility class to store and query info on full blocks up to a given maximum depth `maxDepth`, compared to the current
 * maximum height ever seen.
 * It prunes all the blocks at depth bigger than `maxDepth`, or with height smaller than the first block that was added.
 * Added `attached` if they are at depth `maxDepth`, or if their parent is `attached`, otherwise they are `detached`.
 *
 * The following invariants are guaranteed:
 * 1) No block at depth more than `maxDepth` is still found in the structure, where the depth is computed
 *    with respect to the highest block number of an attached block.
 * 2) No block is retained if its height is smaller than the first block ever added.
 * 3) All added blocks are never pruned if their depth is less then `maxDepth`.
 **/
export class BlockCache<TBlock extends IBlockStub> implements ReadOnlyBlockCache<TBlock> {
    // Next height to be pruned; the cache will not store a block with height strictly smaller than pruneHeight
    private pruneHeight: number;

    private mIsEmpty = true;

    // As the BlockCache has an on-disk store, a lock is used to serialize parallel write accesses
    private lock = new Lock();

    public NewBlock = new BlockEvent<TBlock>();

    /** True before the first block ever is added */
    public get isEmpty() {
        return this.mIsEmpty;
    }

    // the current head of the chain
    private headHash: string;

    private mMaxHeight = 0;
    /** Height of the highest known block */
    public get maxHeight() {
        return this.mMaxHeight;
    }

    /**
     * Returns the minimum height of blocks that can currently be stored.
     *
     * Once at least a block has been added, the minimum height is always guaranteed to be the maximum of:
     * - the height h of the first block ever added, and
     * - the height of a block at depth `maxDepth` from the highest added block.
     **/
    public get minHeight() {
        return Math.max(this.pruneHeight, this.maxHeight - this.maxDepth);
    }

    /**
     * Constructs a block cache that stores blocks up to a maximum depth `maxDepth`.
     * @param maxDepth
     */
    constructor(public readonly maxDepth: number, private readonly blockStore: BlockItemStore<TBlock>) {}

    /** Remove all the blocks that are deeper than maxDepth, and all connected information. */
    private async prune() {
        while (this.pruneHeight < this.minHeight) {
            await this.blockStore.deleteItemsAtHeight(this.pruneHeight);
            this.pruneHeight++;
        }
    }

    /**
     * Returns true if `block` can be attached to the cache, that is any of the following conditions is true:
     *   - the block cache is still empty, so we consider the first block attached by definition;
     *   - its parent is already in the cache;
     *   - it is at depth exactly `this.maxDepth`, as the cache does not record its parents anyway.
     * If not, `block` can only be added as detached.
     * @param block
     */
    public canAttachBlock(block: Readonly<TBlock>): boolean {
        return this.isEmpty || this.hasBlock(block.parentHash) || block.number === this.minHeight;
    }

    /**
     * Processes all the detached blocks at the given height, marking them as attached if necessary.
     * If there are any, add them and repeat with the next height (as some blocks might now have become attached)
     */
    private async processDetached(height: number) {
        const blocksAtHeight = this.blockStore.getBlocksAtHeight(height);
        const blocksToAdd = blocksAtHeight.filter(b => !b.attached);

        for (const { block } of blocksToAdd) {
            // Update the block in the db (as it is now attached)
            await this.blockStore.attached.set(height, block.hash, true);

            // A detached block became attached, thus we need to emit the new block event
            await this.NewBlock.emit(block);
        }

        if (blocksToAdd.length > 0) {
            // Might need to update the maximum height
            await this.updateMaxHeightAndPrune(height);

            await this.processDetached(height + 1);
        }
    }

    /**
     * If minHeight is increased after adding some blocks, some previously detached blocks should now be moved into blocksByHash.
     * Since the process itself could (in rare circumstances) also increase minHeight, we check if this is the case and repeat the cycle.
     */
    private async processDetachedBlocksAtMinHeight() {
        let prevMinHeight: number;
        do {
            prevMinHeight = this.minHeight;
            await this.processDetached(this.minHeight);
        } while (this.minHeight > prevMinHeight); // if the minHeight increased, run again
    }

    private async updateMaxHeightAndPrune(newHeight: number) {
        // If the maximum block height increased, we might have to prune some old info
        if (this.mMaxHeight < newHeight) {
            this.mMaxHeight = newHeight;
            await this.prune();
        }
    }

    /**
     * Adds `block`to the cache.
     * @param block
     * @returns a `BlockAddResult` detailing the outcome of the operation.
     */
    public async addBlock(block: Readonly<TBlock>): Promise<BlockAddResult> {
        try {
            // Acquire the lock, as multiple adds cannot safely occur in parallel
            await this.lock.acquire();

            const attached = this.blockStore.attached.get(block.hash);
            if (attached === true) return BlockAddResult.NotAddedAlreadyExisted; // block already added
            if (block.number < this.minHeight) return BlockAddResult.NotAddedBlockNumberTooLow; // block already too deep, nothing to do
            if (attached === false) return BlockAddResult.NotAddedAlreadyExistedDetached; // block already detached

            // From now on, we can assume that the block can be added (detached or not)

            if (this.isEmpty) {
                // First block added, store its height, so blocks before this point will not be stored.
                this.pruneHeight = block.number;
                this.mIsEmpty = false;
            }

            if (this.canAttachBlock(block)) {
                // This should happen atomically once the BlockStoreItem is refactored to allow batching
                await this.blockStore.block.set(block.number, block.hash, block);
                await this.blockStore.attached.set(block.number, block.hash, true);

                await this.NewBlock.emit(block);

                // If the maximum block height increased, we might have to prune some old info
                await this.updateMaxHeightAndPrune(block.number);

                // Since we added a new block, some detached blocks might become attached
                await this.processDetached(block.number + 1);

                // If the minHeight increased, this could also make some detached blocks ready to be attached
                // This makes sure that they are attached if necessary
                await this.processDetachedBlocksAtMinHeight();
                return BlockAddResult.Added;
            } else {
                // This should happen atomically once the BlockStoreItem is refactored to allow batching
                await this.blockStore.block.set(block.number, block.hash, block);
                await this.blockStore.attached.set(block.number, block.hash, false);
                return BlockAddResult.AddedDetached;
            }
        } finally {
            this.lock.release();
        }
    }

    /**
     * Returns the block with hash `blockHash`, or throws exception if the block is not in cache (attached nor detached).
     * @param blockHash
     */
    public getBlock(blockHash: string): Readonly<TBlock> {
        const block = this.blockStore.block.get(blockHash);
        if (!block) throw new ApplicationError(`Block not found for hash: ${blockHash}.`);
        return block;
    }

    /**
     * Returns true if the block with hash `blockHash` is currently in cache; if `includeDetached` is `true`, detached blocks are also considered.
     **/
    public hasBlock(blockHash: string, includeDetached: boolean = false): boolean {
        const block = this.blockStore.block.get(blockHash);
        const attached = this.blockStore.attached.get(blockHash);

        if (!includeDetached && !attached) return false;
        else return !!block;
    }

    /**
     * Iterator over all the blocks in the ancestry of the block with hash `initialBlockHash` (inclusive).
     * The block with hash `initialBlockHash` must be attached.
     * @param initialBlockHash
     */
    public *ancestry(initialBlockHash: string): IterableIterator<Readonly<TBlock>> {
        let curBlock = this.getBlock(initialBlockHash);
        while (true) {
            yield curBlock;
            if (this.hasBlock(curBlock.parentHash)) {
                curBlock = this.getBlock(curBlock.parentHash);
            } else break;
        }
    }

    /**
     * Finds and returns the nearest ancestor that satisfies `predicate`.
     * Returns `null` if no such ancestor is found.
     * Only tests blocks with height bigger than or equal to `minHeight`, 0 by default.
     */
    public findAncestor(initialBlockHash: string, predicate: (block: Readonly<TBlock>) => boolean, minHeight: number = 0): Readonly<TBlock> | null {
        for (const block of this.ancestry(initialBlockHash)) {
            if (block.number < minHeight) return null; // early abort if below minHeight

            if (predicate(block)) {
                return block;
            }
        }
        return null;
    }

    /**
     * Returns the oldest ancestor of `blockHash` that is stored in the blockCache.
     * @throws `ArgumentError` if `blockHash` is not in the blockCache.
     * @param blockHash
     * The block with hash `blockHash` must be attached.
     */
    public getOldestAncestorInCache(blockHash: string): Readonly<TBlock> {
        if (!this.hasBlock(blockHash)) {
            throw new ArgumentError(`The block with hash ${blockHash} is not in cache`);
        }

        // Find the deepest ancestor that is in cache
        const result = this.findAncestor(blockHash, block => !this.hasBlock(block.parentHash));

        if (!result) {
            // This can never happen, since blockHash already satisfies the predicate in findAncestor
            throw new ApplicationError("An error occurred while searching for the oldest ancestor in cache.");
        }

        return result;
    }

    /**
     * Sets the head block in the cache. AddBlock must be called before setHead can be
     * called for that hash, and the block must be attached.
     * @param blockHash
     */
    public setHead(blockHash: string) {
        if (!this.hasBlock(blockHash)) {
            throw new ArgumentError("Cannot set the head to be a block that isn't in the cache.", blockHash);
        }
        this.headHash = blockHash;
    }

    /**
     * Returns the latest known head block.
     *
     * @throws ApplicationError if the block is not found in the cache. This should never happen, unless
     *         `head` is read before being set.
     */
    public get head(): TBlock {
        if (this.headHash == null) {
            throw new ApplicationError("Head used before the BlockCache is initialized.");
        }
        return this.getBlock(this.headHash);
    }
}

/**
 * Gets the number of confirmations of the transaction with hash `txHash`, assuming that the block with hash
 * `headHash` is the head of the blockchain.
 * Return 0 if no such transaction was found in any ancestor block in the cache.
 * @param cache
 * @param headHash
 * @param txHash
 * @throws `ArgumentError` if the block with hash `headHash` is not in the cache or is not attached.
 */
export function getConfirmations<T extends IBlockStub & TransactionHashes>(cache: ReadOnlyBlockCache<T>, headHash: string, txHash: string): number {
    const headBlock = cache.getBlock(headHash);
    const blockTxIsMinedIn = cache.findAncestor(headHash, block => block.transactionHashes.includes(txHash));
    if (!blockTxIsMinedIn) return 0;
    else return headBlock.number - blockTxIsMinedIn.number + 1;
}
