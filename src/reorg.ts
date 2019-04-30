import { ethers } from "ethers";

import { ApplicationError } from "./dataEntities";
import { EventEmitter } from "events";

class BlockStub {
    // TODO:113: constructor for genesis

    constructor(public readonly height: number, public readonly hash: string, private parent: BlockStub) {
        // TODO:113: guard against null?
    }

    private findInChain(predicate: (block: BlockStub) => boolean) {
        if (!this.parent) {
            return false;
        } else if (predicate(this.parent)) {
            return this.parent;
        } else return this.parent.findInChain(predicate);
    }

    public ancestorWithHash(hash: string): BlockStub | false {
        return this.findInChain(block => block.hash === hash);
    }
    public ancestorWithHeight(height: number): BlockStub | false {
        return this.findInChain(block => block.height === height);
    }

    public prune(depth: number) {
        const minHeight = this.height - depth;
        let ancestor: BlockStub | false;
        if ((ancestor = this.ancestorWithHeight(minHeight))) {
            ancestor.parent = null;
        }
    }

    public asBlockData(): IBlockData {
        return {
            hash: this.hash,
            number: this.height,
            parentHash: this.parent.hash
        };
    }
}

interface IBlockData {
    hash: string;
    number: number;
    parentHash: string;
}

class ReorgDetector extends EventEmitter {
    private headBlock: BlockStub;
    public readonly REORG_EVENT_NAME = "reorg";

    // detects reorgs, allows subscribtion to the reorg event
    // TODO:113: put a clear warning on this provider param, saying that it will reset
    constructor(private readonly provider: ethers.providers.BaseProvider, private readonly maxDepth: number) {
        super();
        this.provider.on("block", this.newBlock);
    }

    private async newBlock(blockNumber) {
        // first prune the existing tree
        this.headBlock.prune(this.maxDepth);

        // now try to extend the existing chain
        const fullBlock = await this.provider.getBlock(blockNumber);
        if (!this.tryExtendChain(fullBlock, this.headBlock)) {
            // if we couldn't extend this is a re-org, reset to the common ancestor
            const commonAncestor = await this.resetToCommonAncestor(fullBlock, this.headBlock);
            this.emit(this.REORG_EVENT_NAME, fullBlock, commonAncestor);
        }
    }

    private async commonAncestor(remoteBlockHash: string, localBlock: BlockStub): Promise<BlockStub> {
        const blockRemote = await this.provider.getBlock(remoteBlockHash);

        const ancestor = localBlock.ancestorWithHash(blockRemote.parentHash);
        if (ancestor) return ancestor;

        const finalBlock = await this.commonAncestor(blockRemote.parentHash, localBlock);
        if (!finalBlock) throw new ApplicationError(`Chain re-org beyond max depth: ${this.maxDepth}.`);
        return finalBlock;
    }

    private tryExtendChain(newBlock: IBlockData, currentHead: BlockStub): boolean {
        if (newBlock.parentHash === currentHead.hash) {
            this.headBlock = new BlockStub(newBlock.number, newBlock.hash, currentHead);
            return true;
        } else return false;
    }

    private async resetToCommonAncestor(newBlock: IBlockData, currentHead: BlockStub): Promise<IBlockData> {
        let commonAncestor: BlockStub | false;
        // the chain has reduced linearly
        if ((commonAncestor = currentHead.ancestorWithHash(newBlock.hash))) {
        }
        // sibling or greater
        else if ((commonAncestor = currentHead.ancestorWithHash(newBlock.parentHash))) {
        }
        // recurse down the ancestry of the provided block, looking for a common ancestor
        else commonAncestor = await this.commonAncestor(newBlock.parentHash, currentHead);

        // reorg - reset to common ancestor
        this.provider.resetEventsBlock(commonAncestor.height + 1);
        this.headBlock = commonAncestor;
        return commonAncestor.asBlockData();
    }
}
