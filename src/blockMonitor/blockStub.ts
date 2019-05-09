import { ArgumentError } from "../dataEntities";

/**
 * A chain of linked block stubs.
 */
export class BlockStubChain {
    private mParent: BlockStubChain | null;
    public get parent() {
        return this.mParent;
    }

    protected constructor(public readonly height: number, public readonly hash: string, parent: BlockStubChain | null) {
        if (parent === undefined) throw new ArgumentError("Undefined parent");
        this.mParent = parent;
    }

    /**
     * Creates a block stub chain with no parent
     * @param height The current height
     * @param hash The current hash
     */
    public static newRoot(height: number, hash: string) {
        return new BlockStubChain(height, hash, null);
    }

    /**
     * Extend this block stub chain with another block stub
     * @param height The current height
     * @param hash The current hash
     */
    public extend(height: number, hash: string): BlockStubChain {
        // extend by exactly one
        if (this.height + 1 !== height)
            throw new ArgumentError("Height not equal parent plus one.", this.height, height);

        return new BlockStubChain(height, hash, this);
    }

    /**
     * Extend this block stub chain by many block stubs
     * @param extensionBlocks
     */
    public extendMany(extensionBlocks: IBlockStub[]) {
        let block: BlockStubChain = this;
        extensionBlocks.forEach(extensionBlock => {
            if (extensionBlock.parentHash !== block.hash) {
                throw new ArgumentError("Parent hashes are not equal.", extensionBlock.parentHash, block.hash);
            }

            block = block.extend(extensionBlock.number, extensionBlock.hash);
        });
        return block;
    }

    /**
     * Traverses the ancestry looking for the correct block.
     * @param predicate Used to search for the correct block
     * @returns null if no matching block found
     */
    private findInChainDeep(predicate: (block: BlockStubChain) => boolean): BlockStubChain | null {
        if (!this.parent) {
            return null;
        } else if (predicate(this.parent)) {
            return this.parent;
        } else return this.parent.findInChainDeep(predicate);
    }

    /**
     * Checks itself before traversing the whole ancestry
     * @param predicate Used to search for the correct block
     * @returns null if no matching block found
     */
    private findInChain(predicate: (block: BlockStubChain) => boolean): BlockStubChain | null {
        if(predicate(this)) return this;
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
        if(height > this.height) return null;

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
            ancestor.mParent = null;
        }
    }

    /**
     * Gets the current block data without full chain information
     */
    public asBlockStub(): IBlockStub {
        return {
            hash: this.hash,
            number: this.height,
            parentHash: this.parent ? this.parent.hash : null
        };
    }
}

export interface IBlockStub {
    hash: string;
    number: number;
    parentHash: string | null;
}
