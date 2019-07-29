import { ApplicationError, ArgumentError } from "../dataEntities";
import { IBlockStub, TransactionHashes } from "../dataEntities/block";

/**
 * This interface represents the read-only view of a BlockCache.
 */
export interface ReadOnlyBlockCache<TBlock extends IBlockStub> {
    readonly maxDepth: number;
    readonly maxHeight: number;
    readonly minHeight: number;
    canAddBlock(block: Readonly<TBlock>): boolean;
    getBlock(blockHash: string): Readonly<TBlock>;
    hasBlock(blockHash: string): boolean;
    ancestry(initialBlockHash: string): IterableIterator<Readonly<TBlock>>;
    findAncestor(initialBlockHash: string, predicate: (block: Readonly<TBlock>) => boolean): Readonly<TBlock> | null;
    getOldestAncestorInCache(blockHash: string): TBlock;
    head: TBlock;
}

/**
 * Utility class to store and query info on full blocks up to a given maximum depth `maxDepth`, compared to the current
 * maximum height ever seen.
 * It prunes all the blocks at depth bigger than `maxDepth`, or with height smaller than the first block that was added.
 * Added blocks are considered `complete` if they are at depth `maxDepth`, or if their parent is `complete`.
 *
 * The following invariants are guaranteed:
 * 1) No complete or pending block at depth more than `maxDepth` is still found in the structure, where the depth is computed
 *    with respect to the highest block number of a complete block.
 * 2) No block is retained if its height is smaller than the first block ever added.
 * 3) All added blocks are never pruned if their depth is less then `maxDepth`.
 **/
export class BlockCache<TBlock extends IBlockStub> implements ReadOnlyBlockCache<TBlock> {
    // Blocks that are already
    private blocksByHash: Map<string, TBlock> = new Map();

    //blocks that can only be added once their parent is added
    private pendingBlocksByHash: Map<string, TBlock> = new Map();

    // store block hashes at a specific height (there could be more than one at some height because of forks)
    private blockHashesByHeight: Map<number, Set<string>> = new Map();

    // Next height to be pruned; the cache will not store a block with height strictly smaller than pruneHeight
    private pruneHeight: number;

    // True before the first block ever is added
    private isEmpty = true;

    // the current head of the chain
    private headHash: string;

    // Height of the highest known block
    private mMaxHeight = 0;
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
    constructor(public readonly maxDepth: number) {}

    // Remove all the blocks that are deeper than maxDepth, and all connected information.
    private prune() {
        while (this.pruneHeight < this.minHeight) {
            for (const hash of this.blockHashesByHeight.get(this.pruneHeight) || []) {
                const deleted = this.blocksByHash.delete(hash) || this.pendingBlocksByHash.delete(hash);

                if (!deleted) {
                    // This would signal a bug
                    throw new ApplicationError(`Tried to delete block with hash ${hash}, but it does not exist.`);
                }
            }
            this.blockHashesByHeight.delete(this.pruneHeight);

            this.pruneHeight++;
        }
    }

    /**
     * Returns true it `block` can be added to the cache, that is if either:
     *   - it is the first block ever seen, or
     *   - its parent is already in the cache, or
     *   - it is at exactly `this.maxDepth`.
     * If not, it can only be added to the pending.
     * @param block
     */
    public canAddBlock(block: Readonly<TBlock>): boolean {
        return this.isEmpty || this.hasBlock(block.parentHash) || block.number === this.minHeight;
    }

    // Processes all pending blocks at the given height, moving them to blocksByHeight if they are now complete.
    // If so, add them and repeat with the next height (as some blocks might now have become complete)
    private processPending(height: number) {
        const blockHashesAtHeight = this.blockHashesByHeight.get(height) || new Set();
        const blockHashesToAdd = [...blockHashesAtHeight].filter(h => this.pendingBlocksByHash.has(h));

        for (const blockHash of blockHashesToAdd) {
            const block = this.pendingBlocksByHash.get(blockHash)!;

            // Remove block from pendingBlocksByHash, add to blocksByHash
            this.blocksByHash.set(blockHash, block);
            this.pendingBlocksByHash.delete(blockHash);

            // Might need to update the maximum height
            this.updateMaxHeightAndPrune(block.number);
        }

        if (blockHashesToAdd.length > 0) {
            this.processPending(height + 1);
        }
    }

    // If minHeight is increased after adding some blocks, some previously pending blocks should now be moved into blocksByHash.
    // Since the process itself could (in rare circumstances) also increase minHeight, we check if this is the case and repeat the cycle.
    private processPendingBlocksAtMinHeight() {
        let prevMinHeight: number;
        do {
            prevMinHeight = this.minHeight;
            this.processPending(this.minHeight);
        } while (this.minHeight > prevMinHeight); // if the minHeight increased, run again
    }

    private updateMaxHeightAndPrune(newHeight: number) {
        // If the maximum block height increased, we might have to prune some old info
        if (this.mMaxHeight < newHeight) {
            this.mMaxHeight = newHeight;
            this.prune();
        }
    }

    /**
     * Adds `block`to the cache.
     * @param block
     * @returns `false` if the block was added (or was already present) as pending, `true` otherwise.
     *      Note: it will return `true` even if the block was not actually added because already present, or because deeper than `maxDepth`.
     */
    public addBlock(block: Readonly<TBlock>): boolean {
        if (this.blocksByHash.has(block.hash)) return true; // block already added
        if (block.number < this.minHeight) return true; // block already too deep, nothing to do

        if (this.pendingBlocksByHash.has(block.hash)) return false; // block already pending

        // From now on, we can assume that the block can be added (pending or not)

        if (this.isEmpty) {
            // First block added, store its height, so blocks before this point will not be stored.
            this.pruneHeight = block.number;
            this.isEmpty = false;
        }

        // Index block by its height
        const hashesByHeight = this.blockHashesByHeight.get(block.number);
        if (hashesByHeight == undefined) {
            this.blockHashesByHeight.set(block.number, new Set([block.hash])); // create new Set
        } else {
            hashesByHeight.add(block.hash); // add to existing Set
        }

        if (this.canAddBlock(block)) {
            this.blocksByHash.set(block.hash, block);

            // If the maximum block height increased, we might have to prune some old info
            this.updateMaxHeightAndPrune(block.number);

            // Since we added a new block, some pending blocks might become complete
            this.processPending(block.number + 1);

            // If the minHeight increased, this could also make some pending blocks complete
            // This makes sure that they are added if necessary
            this.processPendingBlocksAtMinHeight();
            return true;
        } else {
            this.pendingBlocksByHash.set(block.hash, block);
            return false;
        }
    }

    /**
     * Returns the block with hash `blockHash`, or throws exception if the block is not in cache (complete nor pending).
     * @param blockHash
     */
    public getBlock(blockHash: string): Readonly<TBlock> {
        const block = this.blocksByHash.get(blockHash) || this.pendingBlocksByHash.get(blockHash);
        if (!block) throw new ApplicationError(`Block not found for hash: ${blockHash}.`);
        return block;
    }

    /**
     * Returns true if the block with hash `blockHash` is currently in cache; if `includePending` is `true`, pending blocks are also considered.
     **/
    public hasBlock(blockHash: string, includePending: boolean = false): boolean {
        return this.blocksByHash.has(blockHash) || (includePending && this.pendingBlocksByHash.has(blockHash));
    }

    /**
     * Iterator over all the blocks in the ancestry of the block with hash `initialBlockHash` (inclusive).
     * The block with hash `initialBlockHash` must be complete.
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
     * The block with hash `initialBlockHash` must be complete.
     */
    public findAncestor(
        initialBlockHash: string,
        predicate: (block: Readonly<TBlock>) => boolean
    ): Readonly<TBlock> | null {
        for (const block of this.ancestry(initialBlockHash)) {
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
     * The block with hash `blockHash` must be complete.
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
     * called for that hash, and the block must be complete.
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
 * @throws `ArgumentError` if the block with hash `headHash` is not in the cache or is not complete.
 */
export function getConfirmations<T extends IBlockStub & TransactionHashes>(
    cache: ReadOnlyBlockCache<T>,
    headHash: string,
    txHash: string
): number {
    const headBlock = cache.getBlock(headHash);
    const blockTxIsMinedIn = cache.findAncestor(headHash, block => block.transactionHashes.includes(txHash));
    if (!blockTxIsMinedIn) return 0;
    else return headBlock.number - blockTxIsMinedIn.number + 1;
}
