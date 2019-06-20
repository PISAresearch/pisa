import { ethers } from "ethers";
import { ApplicationError, ArgumentError } from "../dataEntities";
import { IBlockStub } from "./blockStub";

/**
 * This interface represents the read-only view of a BlockCache.
 */
export interface ReadOnlyBlockCache {
    readonly maxDepth: number;
    readonly maxHeight: number;
    readonly minHeight: number;
    canAddBlock(block: ethers.providers.Block): boolean;
    getBlockStub(blockHash: string): IBlockStub | null;
    hasBlock(blockHash: string): boolean;
    getConfirmations(headBlockHash: string, txHash: string): number;
    getTransactions(blockHash: string): ethers.providers.TransactionResponse[] | null;
    findAncestor(initialBlockHash: string, predicate: (block: IBlockStub) => boolean): IBlockStub | null;
    getOldestAncestorInCache(blockHash: string): IBlockStub;
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
export class BlockCache implements ReadOnlyBlockCache {
    private blockStubsByHash: Map<string, IBlockStub> = new Map();

    // set of tx hashes per block hash, for fast lookup
    private txHashesByBlockHash: Map<string, Set<string>> = new Map();
    private txsByBlockHash: Map<string, Set<ethers.providers.TransactionResponse>> = new Map();

    // store block hashes at a specific height (there could be more than one at some height because of forks)
    private blockHashesByHeight: Map<number, Set<string>> = new Map();

    // Next height to be pruned; the cache will not store a block with height strictly smaller than pruneHeight
    private pruneHeight: number;

    // True before the first block ever is added
    private isEmpty = true;

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

    // Removes all info related to a block in blockStubsByHash and txHashesByBlockHash
    private removeBlock(blockHash: string) {
        const block = this.blockStubsByHash.get(blockHash);
        if (!block) {
            // This would signal a bug
            throw new ApplicationError(`Block with hash ${blockHash} not found, but it was expected.`);
        }

        this.blockStubsByHash.delete(blockHash);

        // Remove stored set of transactions for this block
        this.txHashesByBlockHash.delete(blockHash);
        this.txsByBlockHash.delete(blockHash);
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
    public canAddBlock(block: ethers.providers.Block): boolean {
        return this.isEmpty || this.hasBlock(block.parentHash) || block.number <= this.minHeight;
    }

    /**
     * `canAddBlock` might return true for blocks that should actually not be added.
     * Here we check that the block is not actually already added, and it is not below a height
     * that would be pruned immediately.
     */
    private shouldAddBlock(block: ethers.providers.Block) {
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
    public addBlock(block: ethers.providers.Block): boolean {
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

        // Save block stub
        const newBlockStub = { hash: block.hash, number: block.number, parentHash: block.parentHash };
        this.blockStubsByHash.set(block.hash, newBlockStub);

        // TODO:174: this is a hack
        // Add set of transactions for this block hash
        const transactionResponses = (block.transactions as any) as ethers.providers.TransactionResponse[];
        if (transactionResponses && transactionResponses[0] && typeof transactionResponses[0] !== "string") {
            // we have full transactions
            this.txHashesByBlockHash.set(block.hash, new Set(transactionResponses.map(t => t.hash!)));
            this.txsByBlockHash.set(block.hash, new Set(transactionResponses));
        } else this.txHashesByBlockHash.set(block.hash, new Set(block.transactions));

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
     * Returns the `IBlockStub` for the block with hash `blockHash`, or `null` if the block is not in cache.
     * @param blockHash
     */
    public getBlockStub(blockHash: string): IBlockStub | null {
        return this.blockStubsByHash.get(blockHash) || null;
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
    private *ancestry(initialBlockHash: string): IterableIterator<IBlockStub> {
        let curBlock = this.getBlockStub(initialBlockHash);
        while (curBlock !== null) {
            yield curBlock;
            curBlock = this.getBlockStub(curBlock.parentHash);
        }
    }

    /**
     * Finds and returns the nearest ancestor that satisfies `predicate`.
     * Returns `null` if no such ancestor is found.
     */
    public findAncestor(initialBlockHash: string, predicate: (block: IBlockStub) => boolean): IBlockStub | null {
        for (const block of this.ancestry(initialBlockHash)) {
            if (predicate(block)) {
                return block;
            }
        }
        return null;
    }

    /**
     * Returns the IBlockStub of the oldest ancestor of `blockStub` that is stored in the blockCache.
     * @throws ArgumentError if `blockHash` is not in the blockCache.
     * @param blockHash
     */
    public getOldestAncestorInCache(blockHash: string): IBlockStub {
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
     * Returns number of confirmations using `headBlockHash` as tip of the blockchain, looking for `txHash` among the ancestor blocks;
     * return 0 if no ancestor containing the transaction is found.
     * Note: This will return 0 for transactions already at depth bigger than `this.maxDepth` when this function is called.
     */
    public getConfirmations(headBlockHash: string, txHash: string): number {
        let depth = 1;
        for (const block of this.ancestry(headBlockHash)) {
            const txsInCurBlock = this.txHashesByBlockHash.get(block.hash);
            if (txsInCurBlock && txsInCurBlock.has(txHash)) {
                return depth;
            }
            depth++;
        }

        // Not found
        return 0;
    }

    // TODO:174:remove
    public getTransactions(blockHash: string) {
        const transactions = this.txsByBlockHash.get(blockHash);
        return transactions ? Array.from(transactions.values()) : null;
    }
}
