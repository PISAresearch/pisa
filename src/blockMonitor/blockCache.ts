import { ethers } from "ethers";
import { ApplicationError } from "../dataEntities";
import { IBlockStub, BlockStubChain } from "./blockStub";

/**
 * Utility class to store and query info on full blocks up to a given maximum depth `maxDepth`, compared to the current
 * maximum height ever seen.
 * It prunes all the blocks at depth bigger than `maxDepth`, or with height smaller than the first block that was added.
 * It does not allow to add blocks without adding their parent first, except if they are at depth `maxDepth`.
 **/
export class BlockCache {
    public blockStubsByHash: Map<string, BlockStubChain> = new Map();

    // set of tx hashes per block hash, for fast lookup
    private txHashesByBlockHash: Map<string, Set<string>> = new Map();

    // store block hashes at a specific height (there could be more than one at some height because of forks)
    public blockHashesByHeight: Map<number, Set<string>> = new Map();

    // Blocks at height smaller than which all blocks have already been pruned
    private minStoredHeight = 0;

    // After the first block is added, its height. Will not store blocks with smaller height
    private initialHeight: number = -1;

    // Height of the highest known block
    private mMaxHeight = 0;
    public get maxHeight() {
        return this.mMaxHeight;
    }

    // Returns the minimum height of blocks that can currently be stored
    public getMinVisibleHeight() {
        return Math.max(this.initialHeight, this.maxHeight - this.maxDepth);
    }

    /**
     * Constructs a block forest that stores blocks up to a maximum depth `maxDepth`.
     * @param maxDepth
     */
    constructor(public readonly maxDepth: number) {}

    // Removes all info related to a block in blockStubsByHash and txHashesByBlockHash
    private removeBlock(blockHash: string) {
        if (this.blockStubsByHash.delete(blockHash) === false) {
            // This would be a bug
            throw new ApplicationError(`Block with hash ${blockHash} not found, but it was expected.`);
        }

        // Remove stored set of transactions for this block
        this.txHashesByBlockHash.delete(blockHash);
    }

    // Remove all the blocks that are deeper than maxDepth, and all connected information.
    private prune() {
        for (let height = this.minStoredHeight; height < this.getMinVisibleHeight(); height++) {
            for (const hash of this.blockHashesByHeight.get(height) || []) {
                this.removeBlock(hash);
            }
            this.blockHashesByHeight.delete(height);
        }
        this.minStoredHeight = this.mMaxHeight - this.maxDepth;
    }

    // Makes a new block stub, linking the parent if available
    private makeBlockStub(hash: string, number: number, parentHash: string) {
        const parentBlockStubChain = this.blockStubsByHash.get(parentHash);
        let newBlockStubChain: BlockStubChain;
        if (parentBlockStubChain === undefined) {
            newBlockStubChain = BlockStubChain.newRoot({ hash, number, parentHash });
        } else {
            newBlockStubChain = parentBlockStubChain.extend({ hash, number, parentHash });
        }
        return newBlockStubChain;
    }

    /**
     * Returns true it `block` can be added to the cache, that is if either:
     *   - it is the first block ever seen, or
     *   - its parent is already in the cache, or
     *   - it is at depth least `this.maxDepth`.
     * @param block
     */
    public canAddBlock(block: ethers.providers.Block): boolean {
        return (
            this.initialHeight === -1 || this.hasBlock(block.parentHash) || block.number <= this.getMinVisibleHeight()
        );
    }

    /**
     * Adds `block`to the cache.
     * @param block
     * @returns `true` if the block was added, `false` if the block was not added because too deep or already there.
     * @throws `ApplicationError` if the block cannot be added because its parent is not in cache.
     */
    public addBlock(block: ethers.providers.Block): boolean {
        if (this.initialHeight === -1) {
            // First block added, blocks before this point will not be stored.#
            this.initialHeight = block.number;
        } else {
            if (this.blockStubsByHash.has(block.hash)) {
                // block already in memory
                return false;
            }

            if (block.number < this.getMinVisibleHeight()) {
                // block too deep
                return false;
            }

            // If the block's parent is above the minimum visible height, it needs to be added first
            if (!this.canAddBlock(block)) {
                throw new ApplicationError("Tried to add a block before its parent block.");
            }
        }

        // Update data structures

        // Save block stub
        const newBlockStub = this.makeBlockStub(block.hash, block.number, block.parentHash);
        this.blockStubsByHash.set(block.hash, newBlockStub);

        // Add set of transactions for this block hash
        this.txHashesByBlockHash.set(block.hash, new Set(block.transactions));

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
     * Returns the `BlockStubChain` for the block with hash `blockHash`, or `null` if the block is not in cache.
     * @param blockHash
     */
    public getBlockStubChain(blockHash: string): BlockStubChain | null {
        return this.blockStubsByHash.get(blockHash) || null;
    }

    /**
     * Returns the `IBlockStub` for the block with hash `blockHash`, or `null` if the block is not in cache.
     * @param blockHash
     */
    public getBlockStub(blockHash: string): IBlockStub | null {
        const blockStubChain = this.getBlockStubChain(blockHash);
        if (blockStubChain === null) {
            return null;
        }
        return blockStubChain.asBlockStub();
    }

    /**
     * Returns true if the block with hash `blockHash` is currently in cache.
     **/
    public hasBlock(blockHash: string) {
        return this.blockStubsByHash.has(blockHash);
    }

    /**
     * Returns number of confirmations using `headBlockHash` as tip of the blockchain, looking for `txHash` among the ancestor blocks;
     * return 0 if no ancestor containing the transaction is found.
     * Note: This will return 0 for transactions already at depth bigger than `this.maxDepth` when this function is called.
     */
    public getConfirmations(headBlockHash: string, txHash: string): number {
        let depth = 0;
        let curBlock = this.getBlockStub(headBlockHash);
        while (curBlock !== null) {
            const txsInCurBlock = this.txHashesByBlockHash.get(curBlock.hash);
            if (txsInCurBlock && txsInCurBlock.has(txHash)) {
                return depth + 1;
            }
            curBlock = this.getBlockStub(curBlock.parentHash);
            depth++;
        }

        // Not found
        return 0;
    }
}
