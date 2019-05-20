import { ethers } from "ethers";
import { ApplicationError } from "../dataEntities";
import { IBlockStub, BlockStubChain } from "./blockStub";

// adds item to map.get(key), but make sure it exists first
function addItemToKeyedSet<T, U>(map: Map<T, Set<U>>, key: T, item: U) {
    const set = map.get(key);
    if (set === undefined) {
        map.set(key, new Set([item]));
    } else {
        set.add(item);
    }
}

// removes item from map.get(key), and also delete the resulting set if empty
function removeItemFromKeyedSet<T, U>(map: Map<T, Set<U>>, key: T, item: U) {
    const set = map.get(key);
    if (set === undefined || set.delete(item) === false) {
        throw new ApplicationError("Tried to remove item from a set that does not contain it.");
    }
    if (set.size === 0) {
        map.delete(key);
    }
}

/**
 * Utility class to store and query info on full blocks up to a given maximum depth `maxDepth`.
 * It prunes all the blocks at depth bigger than `maxDepth`, or with height smaller than the first block that was added.
 * It does not allow to add blocks without adding their parent first, except if they are at depth `maxDepth`.
 **/
export class BlockCache {
    public blockStubsByHash: Map<string, BlockStubChain> = new Map();

    // store block hashes at a specific height (there could be more than one at some height because of forks)
    public blockHashesByHeight: Map<number, Set<string>> = new Map();

    // maps transaction hashes to blocks containing them
    public blockHashesByTxHash: Map<string, Set<string>> = new Map();

    // set of tx hashes per block hash, for fast lookup
    public txHashesByBlockHash: Map<string, Set<string>> = new Map();

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

    // Removes all info related to a block in blocksByHash and blockHashesByTxHash
    private pruneBlock(blockHash: string) {
        const transactionHashes = this.txHashesByBlockHash.get(blockHash);
        if (transactionHashes === undefined) {
            // This would be a bug
            throw new ApplicationError(`Block with hash ${blockHash} not found, but it was expected.`);
        }

        this.blockStubsByHash.delete(blockHash);

        // For each txHash in the block, remove the block hash from blockHashesByTxHash
        for (let txHash of transactionHashes) {
            removeItemFromKeyedSet(this.blockHashesByTxHash, txHash, blockHash);
        }

        // Remove stored set of transactions for this block
        this.txHashesByBlockHash.delete(blockHash);
    }

    // Remove all the blocks that are deeper than maxDepth, and all connected information.
    private prune() {
        for (let height = this.minStoredHeight; height < this.getMinVisibleHeight(); height++) {
            const hashesByHeight = this.blockHashesByHeight.get(height);
            if (hashesByHeight !== undefined) {
                for (let hash of hashesByHeight) {
                    this.pruneBlock(hash);
                }
                this.blockHashesByHeight.delete(height);
            }
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

    public canAddBlock(block: ethers.providers.Block): boolean {
        return (
            this.initialHeight === -1 || this.hasBlock(block.parentHash) || block.number <= this.getMinVisibleHeight()
        );
    }

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
            if (block.number > this.getMinVisibleHeight() && !this.hasBlock(block.parentHash)) {
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
        addItemToKeyedSet(this.blockHashesByHeight, block.number, block.hash);

        // Link all the tx hashes of this block to the block hash
        for (let txHash of block.transactions || []) {
            // Add this block among the block containing transaction txHash
            addItemToKeyedSet(this.blockHashesByTxHash, txHash, block.hash);
        }

        // If the maximum block height increased, we might have to prune some old info
        if (this.mMaxHeight < block.number) {
            this.mMaxHeight = Math.max(this.mMaxHeight, block.number);
            this.prune();
        }

        return true;
    }

    public getBlockStubChain(blockHash: string): BlockStubChain | null {
        const blockStubChain = this.blockStubsByHash.get(blockHash);
        if (blockStubChain === undefined) {
            return null;
        }
        return blockStubChain;
    }

    public getBlockStub(blockHash: string): IBlockStub | null {
        const blockStubChain = this.getBlockStubChain(blockHash);
        if (blockStubChain === null) {
            return null;
        }
        return blockStubChain.asBlockStub();
    }

    public hasBlock(blockHash: string) {
        return this.blockStubsByHash.has(blockHash);
    }

    /**
     * Returns the distance between the block with hash `headBlockHash` and the ancestor containing transaction `txHash`, if any;
     * return 0 if no such ancestor is found.
     * Note: This will return 0 for transactions already at depth bigger than `this.maxDepth` when this function is called.
     */
    public getConfirmations(headBlockHash: string, txHash: string): number {
        let depth = 0;
        let curBlock = this.getBlockStub(headBlockHash);
        while (curBlock !== null) {
            const txsInCurBlock = this.txHashesByBlockHash.get(curBlock.hash) || new Set();
            if (txsInCurBlock.has(txHash)) {
                return depth + 1;
            }
            curBlock = this.getBlockStub(curBlock.parentHash);
            depth++;
        }

        // Not found
        return 0;
    }
}
