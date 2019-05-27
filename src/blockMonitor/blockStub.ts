import { ArgumentError } from "../dataEntities";

/**
 * A chain of linked block stubs.
 */
export class BlockStubChain {
    public readonly height: number;
    public readonly hash: string;
    public readonly parentHash: string;
    private mParentChain: BlockStubChain | null;
    public get parentChain() {
        return this.mParentChain;
    }

    protected constructor(block: IBlockStub, parentChain: BlockStubChain | null) {
        if (parentChain === undefined) throw new ArgumentError("Undefined parent chain");

        if (parentChain && block.parentHash !== parentChain.hash) {
            throw new ArgumentError("Parent hashes are not equal.", block.parentHash, parentChain.hash);
        }

        this.height = block.number;
        this.hash = block.hash;
        this.parentHash = block.parentHash;
        this.mParentChain = parentChain;
    }

    /**
     * Creates a block stub chain with no parent
     * @param block The current IBlockStub
     */
    public static newRoot(block: IBlockStub) {
        return new BlockStubChain(block, null);
    }

    /**
     * Extend this block stub chain with another block stub
     * @param newBlock The new current block
     */
    public extend(newBlock: IBlockStub): BlockStubChain {
        // extend by exactly one
        if (this.height + 1 !== newBlock.number)
            throw new ArgumentError("Height not equal parent plus one.", this.height, newBlock.number);

        return new BlockStubChain(newBlock, this);
    }

    /**
     * Extend this block stub chain by many block stubs
     * @param extensionBlocks
     */
    public extendMany(extensionBlocks: IBlockStub[]) {
        let block: BlockStubChain = this;
        extensionBlocks.forEach(extensionBlock => {
            block = block.extend(extensionBlock);
        });
        return block;
    }

    /**
     * Traverses the ancestry looking for the correct block.
     * @param predicate Used to search for the correct block
     * @returns null if no matching block found
     */
    private findInChainDeep(predicate: (block: BlockStubChain) => boolean): BlockStubChain | null {
        if (!this.parentChain) {
            return null;
        } else if (predicate(this.parentChain)) {
            return this.parentChain;
        } else return this.parentChain.findInChainDeep(predicate);
    }

    /**
     * Checks itself before traversing the whole ancestry
     * @param predicate Used to search for the correct block
     * @returns null if no matching block found
     */
    private findInChain(predicate: (block: BlockStubChain) => boolean): BlockStubChain | null {
        if (predicate(this)) return this;
        else return this.findInChainDeep(predicate);
    }

    /**
     * Traverses ancestry looking for block with supplied hash. Also checks the head of the chain.
     * @param hash Search for ancestor with this hash
     * @returns null if no matching block found
     */
    public ancestorWithHash(hash: string): BlockStubChain | null {
        return this.findInChain(block => block.hash === hash);
    }

    /**
     * Traverses ancestry looking for block with supplied height. Also checks the head of the chain.
     * @param height Search for ancestor with this height
     * @returns null if no matching block found
     */
    public ancestorWithHeight(height: number): BlockStubChain | null {
        // if the head has height less than this block, no other ancestors can have a greater height.
        if (height > this.height) return null;

        return this.findInChain(block => block.height === height);
    }

    /**
     * Removes blocks from the chain below a supplied height
     * @param minHeight The minimum height to keep in this chain
     */
    public prune(minHeight: number) {
        if (minHeight > this.height)
            throw new ArgumentError("Cannot prune above current height.", minHeight, this.height);

        let ancestor: BlockStubChain;
        if ((ancestor = this.ancestorWithHeight(minHeight)!)) {
            ancestor.mParentChain = null;
        }
    }

    /**
     * Gets the current block data without full chain information
     */
    public asBlockStub(): IBlockStub {
        return {
            hash: this.hash,
            number: this.height,
            parentHash: this.parentHash
        };
    }
}

export interface IBlockStub {
    hash: string;
    number: number;
    parentHash: string;
}
