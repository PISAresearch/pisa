import { ethers } from "ethers";
import { StartStopService, ArgumentError } from "../dataEntities";
import logger from "../logger";
import { BlockStubChain, IBlockStub } from "./blockStub";
import { ReorgHeightListenerStore } from "./reorgHeightListener";

/**
 * Keeps track of the current head of the blockchain, and emits events when reorgs are observed
 */
export class ReorgDetector extends StartStopService {
    private headBlock: BlockStubChain;
    private handlingBlock: boolean;
    /**
     * Emitted when a reorg starts. Emits block number.
     */
    public static readonly REORG_START_EVENT = "reorg_start";

    /**
     * Emitted when a reorg is completed. Emits block number.
     */
    public static readonly REORG_END_EVENT = "reorg_end";

    /**
     * Emitted when a reorg is observed that is beyond the depth tracked by this detector.
     * Emits the current head block, and the new block which cannot be reconciled.
     */
    public static readonly REORG_BEYOND_DEPTH_EVENT = "reorg_beyond_depth";

    /**
     * Keeps track of the current head of the blockchain, and emits events when reorgs are observed
     * @param provider Will have resetEvents called upon reorg
     * @param maxDepth The maximum depth to which this detector should track reorgs
     * @param store A store for reorg listeners
     */
    constructor(
        private readonly provider: ethers.providers.BaseProvider,
        public readonly maxDepth: number,
        public readonly store: ReorgHeightListenerStore
    ) {
        super("Reorg detector");
        this.handleNewBlock = this.handleNewBlock.bind(this);
        this.conductReorg = this.conductReorg.bind(this);
    }

    protected startInternal() {
        this.provider.on("block", this.handleNewBlock);
    }
    protected stopInternal() {
        this.provider.removeListener("block", this.handleNewBlock);
    }

    /**
     * Detect a reorg if a new block is observed
     * @param blockNumber
     */
    private async handleNewBlock(blockNumber: number) {
        // we should lock here so that we dont fire reorg events concurrently
        // it doesnt matter if a reorg is missed immediately, it will be picked up on the next block emission
        if (!this.handlingBlock) {
            this.handlingBlock = true;

            try {
                // get the full block information for the incoming block
                const fullBlock = await this.provider.getBlock(blockNumber);
                if (!this.headBlock) {
                    // no current block - start of operation
                    this.headBlock = BlockStubChain.newRoot(fullBlock.number, fullBlock.hash);
                } else if (fullBlock.parentHash === this.headBlock.hash) {
                    // direct parent - extend the chain
                    this.headBlock = this.headBlock.extend(fullBlock.number, fullBlock.hash);
                } else {
                    // if we couldn't extend this is a re-org, reset to the common ancestor
                    const { commonAncestor, differenceBlocks } = await this.findCommonAncestor(
                        fullBlock,
                        this.headBlock,
                        this.maxDepth
                    );

                    if (commonAncestor === this.headBlock) {
                        // direct ancestor - extend the chain
                        this.headBlock = this.headBlock.extendMany(differenceBlocks.reverse());
                    } else if (commonAncestor === null) {
                        // if we couldn't find a common ancestor the reorg must be too deep
                        this.emit(ReorgDetector.REORG_BEYOND_DEPTH_EVENT, this.headBlock.asBlockStub(), fullBlock);
                        // conduct a reorg with a new genesis
                        const oldestBlock = differenceBlocks[differenceBlocks.length - 1];
                        await this.conductReorg(BlockStubChain.newRoot(oldestBlock.number, oldestBlock.hash));
                    } else {
                        // indirect ancestor found - conduct reorg
                        await this.conductReorg(commonAncestor);
                    }
                }

                // prune events past the max depth
                this.prune();
            } catch (doh) {
                logger.error(`${this.name}: Unexpected error.`);
                const dohError = doh as Error;
                if (dohError) {
                    logger.error(dohError.stack!);
                }
            } finally {
                this.handlingBlock = false;
            }
        }
    }

    /**
     * Updates local state according to a new head, and informs subscribers
     * @param newHead
     */
    private async conductReorg(newHead: BlockStubChain) {
        // we found a commong ancestor that was not the head - therfore we need
        // to conduct a reorg. Inform other listeners so that they might pause their
        // processing in the meantime

        this.provider.polling = false;
        this.emit(ReorgDetector.REORG_START_EVENT, newHead.height);
        // set the new head
        this.headBlock = newHead;

        // emit reorg listener events for everything above the ancestor
        // it's important that we emit all of these, and be sure that they've been
        // completed before turning polling back on so as to give listeners a chance
        // to add/remove listeners before we rewind.
        await this.emitReorgHeightEvents(newHead.height + 1);

        // reset this provider so that we can continue moving forward from here
        this.provider.resetEventsBlock(newHead.height + 1);

        // and emit the end reorg event
        this.emit(ReorgDetector.REORG_END_EVENT, newHead.height);
        this.provider.polling = true;
    }

    /**
     * Since this reorg detector only detects reorgs below a max depth it can prune records
     * that it has below that
     */
    private prune() {
        // prune the chain
        const minHeight = this.headBlock.height - this.maxDepth;
        this.headBlock.prune(minHeight);

        // prune current re-org height listeners
        this.store.prune(minHeight);
    }

    /**
     * Fire any listeners to the reorg height events
     * @param height
     */
    private async emitReorgHeightEvents(height: number) {
        // find all the block events above a certain height
        const listeners = this.store.getListenersFromHeight(height);

        return await Promise.all(
            listeners.map(async listener => {
                await listener();
                // only we are sure this listener has executed correctly can we remove the listener
                this.store.removeListener(height, listener);
            })
        );
    }

    /**
     * Finds the common ancestor between a local block stub chain and the block that corresponds
     * to a given hash. It does this by recursively requesting blocks for this hash from the provider and
     * checking whether the parent exists in the local chain. Will not look below a certain height.
     *
     * This is an O(n) operation meaning that it can be expensive when called in a loop - there are other ways we could
     * arrange this logic to mitigate this. See: https://github.com/PISAresearch/pisa/issues/130
     *
     * @param remoteBlockHash The hash corresponding to the head of the remote block
     * @param localBlock The local chain with which to compare the new remote one
     * @param differenceBlocks If a common ancestor is found the blocks between it and the remote block are populated here
     * @param minHeight The minimum height to search to
     *
     */
    public async findCommonAncestorDeep(
        remoteBlockHash: string,
        localBlock: BlockStubChain,
        differenceBlocks: IBlockStub[],
        minHeight: number
    ): Promise<BlockStubChain | null> {
        const blockRemote = await this.provider.getBlock(remoteBlockHash);
        if (!blockRemote) return null;
        differenceBlocks.push(blockRemote);
        if (blockRemote.number <= minHeight) return null;

        const ancestor = localBlock.ancestorWithHash(blockRemote.parentHash);
        if (ancestor) return ancestor;

        return await this.findCommonAncestorDeep(blockRemote.parentHash, localBlock, differenceBlocks, minHeight);
    }

    /**
     * Finds the common ancestor between a new block and the current head. Looks first shallowly, then
     * deep.BlockHeightListenerStore
     * @param newBlock
     * @param currentHead
     */
    public async findCommonAncestor(
        newBlock: IBlockStub,
        currentHead: BlockStubChain,
        maxDepth: number
    ): Promise<{ commonAncestor: BlockStubChain | null; differenceBlocks: IBlockStub[] }> {
        if (newBlock.parentHash === null) {
            throw new ArgumentError("newBlock should have a parentHash");
        }

        let commonAncestor: BlockStubChain | null;
        let differenceBlocks: IBlockStub[] = [];
        const minHeight = currentHead.height - maxDepth;
        // the chain has reduced linearly
        if ((commonAncestor = currentHead.ancestorWithHash(newBlock.hash))) {
        }
        // sibling or greater
        else if ((commonAncestor = currentHead.ancestorWithHash(newBlock.parentHash))) {
            differenceBlocks.push(newBlock);
        }
        // recurse down the ancestry of the provided block, looking for a common ancestor
        else {
            differenceBlocks.push(newBlock);
            commonAncestor = await this.findCommonAncestorDeep(
                newBlock.parentHash,
                currentHead,
                differenceBlocks,
                minHeight
            );
        }

        return { commonAncestor, differenceBlocks };
    }

    /**
     * Add a listener for reorg events that reorg the chain to a common ancestor below a certain height. These events are guaranteed
     * to fire after ReorgDetector.REORG_START_EVENT and before ReorgDetector.REORG_END_EVENT
     * @param listener This listener will not be present in the listeners() or listenerCount() properties as it
     * can be an async callback, but we must await for it's completion here before emitting synchronous callbacks. So
     * it must be emitted in a different way.
     */
    public addReorgHeightListener(height: number, listener: () => Promise<void>) {
        this.store.addListener(height, listener);
    }

    /**
     * The current head of the chain
     */
    public get head() {
        if (this.headBlock) return this.headBlock.asBlockStub();
        else return null;
    }
}
