import { ethers } from "ethers";
import { ApplicationError, StartStopService } from "../dataEntities";
import logger from "../logger";
import { BlockStubChain, IBlockStub } from "./blockStub";

export class ReorgDetector extends StartStopService {
    private headBlock: BlockStubChain;
    private readonly blockHeightListeners: BlockHeightListeners = new BlockHeightListeners();
    // TODO: 113: doc what is returned
    public static readonly REORG_START_EVENT = "reorg_start";
    public static readonly REORG_END_EVENT = "reorg_end";
    public static readonly REORG_BEYOND_DEPTH_EVENT = "reorg_beyond_depth";

    // detects reorgs, allows subscribtion to the reorg event
    // TODO:113: put a clear warning on this provider param, saying that it will reset
    constructor(private readonly provider: ethers.providers.BaseProvider, public readonly maxDepth: number) {
        super("Reorg detector");
        this.newBlock = this.newBlock.bind(this);
    }

    protected startInternal() {
        this.provider.on("block", this.newBlock);
    }
    protected stopInternal() {
        this.provider.removeListener("block", this.newBlock);
    }

    private async newBlock(blockNumber) {
        try {
            // now try to extend the existing chain
            const fullBlock = await this.provider.getBlock(blockNumber);
            if (!this.headBlock) {
                this.headBlock = BlockStubChain.genesis(fullBlock.number, fullBlock.hash);
            } else if (fullBlock.parentHash === this.headBlock.hash) {
                this.headBlock = this.headBlock.extend(fullBlock.number, fullBlock.hash);
            } else {
                // if we couldn't extend this is a re-org, reset to the common ancestor
                const { commonAncestor, differenceBlocks } = await this.findCommonAncestor(fullBlock, this.headBlock);

                // if we couldn't find a common ancestor the reorg must be too deep
                if (commonAncestor === null) {
                    this.emit(ReorgDetector.REORG_BEYOND_DEPTH_EVENT, fullBlock);
                } else if (commonAncestor === this.headBlock) {
                    // this is still a direct extension, lets complete it
                    this.headBlock = this.headBlock.extendMany(differenceBlocks);
                } else {
                    this.emit(ReorgDetector.REORG_START_EVENT, commonAncestor.height)

                    // set the new head
                    this.headBlock = commonAncestor;

                    // emit reorg listener events for everything above the ancestor
                    // it's important that we emit all of these, and be sure that they've been
                    // completed before turning polling back on so as to give listeners a chance
                    // to add/remove listeners before we rewind.
                    await this.emitReorgHeightEvents(commonAncestor.height + 1);

                    // reset this provider so that we can continue moving forward from here
                    this.provider.resetEventsBlock(commonAncestor.height + 1);

                    // and emit the reorg event
                    this.emit(ReorgDetector.REORG_END_EVENT, commonAncestor.height)
                }
            }

            // TODO:113: when people add events they need to guard against the actual re-org

            // prune events past the max depth
            this.prune();
        } catch (doh) {
            logger.error(`${this.name}: Unexpected error.`);
            const dohError = doh as Error;
            if (dohError) {
                logger.error(dohError.stack);
            }
        }
    }

    private prune() {
        // prune the chain
        const minHeight = this.headBlock.height - this.maxDepth;
        this.headBlock.prune(minHeight);

        // prune current re-org height listeners
        this.blockHeightListeners.prune(minHeight);
    }

    private async emitReorgHeightEvents(height: number) {
        // find all the block events above a certain height
        const listeners = this.blockHeightListeners.getListenersFromHeight(height);

        return await Promise.all(
            listeners.map(async l => {
                await l.listener();
                this.blockHeightListeners.removeListener(l);
            })
        );
    }

    public async commonAncestor(
        remoteBlockHash: string,
        localBlock: BlockStubChain,
        differenceBlocks: IBlockStub[]
    ): Promise<BlockStubChain> {
        // TODO:113: commmon ancestor appears to be going too deep, we were seeing it go past the head for the big spliiter test chain
        // TODO:113: and calling a reorg at block 3 instead of 4
        const blockRemote = await this.provider.getBlock(remoteBlockHash);
        differenceBlocks.push(blockRemote);

        const ancestor = localBlock.ancestorWithHash(blockRemote.parentHash);
        if (ancestor) return ancestor;

        const minHeight = this.headBlock.height - this.maxDepth;
        if (blockRemote.number <= minHeight) return null;
        const finalBlock = await this.commonAncestor(blockRemote.parentHash, localBlock, differenceBlocks);
        if (!finalBlock) return null;
        return finalBlock;
    }

    public async findCommonAncestor(
        newBlock: IBlockStub,
        currentHead: BlockStubChain
    ): Promise<{ commonAncestor: BlockStubChain; differenceBlocks: IBlockStub[] }> {
        let commonAncestor: BlockStubChain;
        let differenceBlocks: IBlockStub[] = [];
        // the chain has reduced linearly
        if ((commonAncestor = currentHead.ancestorWithHash(newBlock.hash))) {
        }
        // sibling or greater
        else if ((commonAncestor = currentHead.ancestorWithHash(newBlock.parentHash))) {
            differenceBlocks.push(newBlock);
        }
        // recurse down the ancestry of the provided block, looking for a common ancestor
        else commonAncestor = await this.commonAncestor(newBlock.parentHash, currentHead, differenceBlocks);

        return { commonAncestor, differenceBlocks };
    }

    public addReorgHeightListener(listener: IBlockHeightListener) {
        this.blockHeightListeners.addListener(listener);

        // TODO:113: should this be added to the listener count? probably for consistency, yes
    }

    public removeReorgHeightListener(listener: IBlockHeightListener) {
        this.blockHeightListeners.removeListener(listener);
    }

    /**
     * The current head of the chain
     */
    public get head() {
        if (this.headBlock) return this.headBlock.asBlockStub();
        else return null;
    }
}

interface IBlockHeightListener {
    height: number;
    listener: () => Promise<void>;
}

export class BlockHeightListeners {
    private listeners: {
        [height: number]: Set<IBlockHeightListener>;
    } = {};

    public prune(minHeight: number) {
        Object.keys(this.listeners)
            .map(k => Number.parseInt(k))
            .filter(r => r < minHeight)
            .forEach(k => delete this.listeners[k]);
    }

    public addListener(listener: IBlockHeightListener) {
        // if a re-org takes place past this block then we need to do call the callback
        if (this.listeners[listener.height]) this.listeners[listener.height].add(listener);
        else this.listeners[listener.height] = new Set([listener]);
    }

    public removeListener(listener: IBlockHeightListener) {
        const listeners = this.listeners[listener.height];
        listeners.delete(listener);
        if (listeners.size === 0) delete this.listeners[listener.height];
    }

    public getListenersFromHeight(height: number) {
        return ([] as Array<IBlockHeightListener>).concat(
            ...Object.keys(this.listeners)
                .map(k => Number.parseInt(k))
                .filter(f => f >= height)
                .map(k => Array.from(this.listeners[k]))
        );
    }
}
