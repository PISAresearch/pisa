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
    getBlockStub(blockHash: string): Readonly<TBlock>;
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
 * It does not allow to add blocks without adding their parent first, except if they are at depth `maxDepth`.
 *
 * The following invariants are guaranteed:
 * 1) Adding a block after the parent was added will never throw an exception.
 * 2) No block at depth more than `maxDepth` is still found in the structure.
 * 3) No block is retained if its height is smaller than the first block ever added.
 * 4) All blocks added are never pruned if their depth is less then `maxDepth`.
 * 5) No block can be added before their parent, unless their height is equal to the height of the first added block, or
 *    their depth is `maxDepth`.
 *
 * Note that in order to guarantee the invariant (1), `addBlock` can be safely called even for blocks that will not
 * actually be added (for example because they are already too deep); in that case, it will return `false`.
 **/
export class BlockCache<TBlock extends IBlockStub> implements ReadOnlyBlockCache<TBlock> {
    private blockStubsByHash: Map<string, TBlock> = new Map();

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

    // Removes all info related to a block in blockStubsByHash
    private removeBlock(blockHash: string) {
        const block = this.blockStubsByHash.get(blockHash);
        if (!block) {
            // This would signal a bug
            throw new ApplicationError(`Block with hash ${blockHash} not found, but it was expected.`);
        }

        this.blockStubsByHash.delete(blockHash);
    }

    // Remove all the blocks that are deeper than maxDepth, and all connected information.
    private prune() {
        while (this.pruneHeight < this.minHeight) {
            for (const hash of this.blockHashesByHeight.get(this.pruneHeight) || []) {
                this.removeBlock(hash);
            }
            this.blockHashesByHeight.delete(this.pruneHeight);

            this.pruneHeight++;
        }
    }

    /**
     * Returns true it `block` can be added to the cache, that is if either:
     *   - it is the first block ever seen, or
     *   - its parent is already in the cache, or
     *   - it is at depth least `this.maxDepth`.
     * @param block
     */
    public canAddBlock(block: Readonly<TBlock>): boolean {
        return this.isEmpty || this.hasBlock(block.parentHash) || block.number <= this.minHeight;
    }

    /**
     * `canAddBlock` might return true for blocks that should actually not be added.
     * Here we check that the block is not actually already added, and it is not below a height
     * that would be pruned immediately.
     */
    private shouldAddBlock(block: Readonly<TBlock>) {
        if (this.blockStubsByHash.has(block.hash)) {
            // block already in memory
            return false;
        }

        if (block.number < this.minHeight) {
            // block too deep
            return false;
        }
        return true;
    }

    /**
     * Adds `block`to the cache.
     * @param block
     * @returns `true` if the block was added, `false` if the block was not added (because too deep or already in cache).
     * @throws `ApplicationError` if the block cannot be added because its parent is not in cache.
     */
    public addBlock(block: Readonly<TBlock>): boolean {
        // If the block's parent is above the minimum visible height, it needs to be added first
        if (!this.canAddBlock(block)) {
            throw new ApplicationError("Tried to add a block before its parent block.");
        }

        if (this.isEmpty) {
            // First block added, store its height, so blocks before this point will not be stored.
            this.pruneHeight = block.number;
            this.isEmpty = false;
        } else if (!this.shouldAddBlock(block)) {
            // We do not actually need to add the block
            return false;
        }

        // Update data structures

        // Save block
        this.blockStubsByHash.set(block.hash, block);

        // Index block by its height
        const hashesByHeight = this.blockHashesByHeight.get(block.number);
        if (hashesByHeight === undefined) {
            this.blockHashesByHeight.set(block.number, new Set([block.hash]));
        } else {
            hashesByHeight.add(block.hash);
        }

        // If the maximum block height increased, we might have to prune some old info
        if (this.mMaxHeight < block.number) {
            this.mMaxHeight = block.number;
            this.prune();
        }

        return true;
    }

    /**
     * Returns the `IBlockStub` for the block with hash `blockHash`, or throws exception if the block is not in cache.
     * @param blockHash
     */
    public getBlockStub(blockHash: string): Readonly<TBlock> {
        const blockStub = this.blockStubsByHash.get(blockHash);
        if (!blockStub) throw new ApplicationError(`Block not found for hash: ${blockHash}.`);
        return blockStub;
    }

    /**
     * Returns true if the block with hash `blockHash` is currently in cache.
     **/
    public hasBlock(blockHash: string): boolean {
        return this.blockStubsByHash.has(blockHash);
    }

    /**
     * Iterator over all the blocks in the ancestry of the block with hash `initialBlockHash` (inclusive).
     * @param initialBlockHash
     */
    public *ancestry(initialBlockHash: string): IterableIterator<Readonly<TBlock>> {
        let curBlock = this.getBlockStub(initialBlockHash);
        while (true) {
            yield curBlock;
            if (this.hasBlock(curBlock.parentHash)) {
                curBlock = this.getBlockStub(curBlock.parentHash);
            } else break;
        }
    }

    /**
     * Finds and returns the nearest ancestor that satisfies `predicate`.
     * Returns `null` if no such ancestor is found.
     */
    public findAncestor(initialBlockHash: string, predicate: (block: Readonly<TBlock>) => boolean): Readonly<TBlock> | null {
        for (const block of this.ancestry(initialBlockHash)) {
            if (predicate(block)) {
                return block;
            }
        }
        return null;
    }

    /**
     * Returns the oldest ancestor of `blockStub` that is stored in the blockCache.
     * @throws ArgumentError if `blockHash` is not in the blockCache.
     * @param blockHash
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
     * called for that hash.
     * @param blockHash
     */
    public setHead(blockHash: string) {
        if (!this.hasBlock(blockHash)) {
            throw new ArgumentError("Cannot set the head for a block that isn't in the cash.", blockHash);
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
        return this.getBlockStub(this.headHash);
    }
}

/**
 * Gets the number of confirmations of the transaction with hash `txHash`, assuming that the block with hash
 * `headHash` is the head of the blockchain.
 * Return 0 if no such transaction was found in any ancestor block in the cache.
 * @param cache
 * @param headHash
 * @param txHash
 * @throws `ArgumentError` if the block with hash `headHash` is not in the cache.
 */
export function getConfirmations<T extends IBlockStub & TransactionHashes>(
    cache: ReadOnlyBlockCache<T>,
    headHash: string,
    txHash: string
): number {
    const headBlock = cache.getBlockStub(headHash);
    const blockTxIsMinedIn = cache.findAncestor(headHash, block => block.transactionHashes.includes(txHash));
    if (!blockTxIsMinedIn) return 0;
    else return headBlock.number - blockTxIsMinedIn.number + 1;
}
