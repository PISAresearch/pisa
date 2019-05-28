import { ethers } from "ethers";
import { ArgumentError, StartStopService } from "../dataEntities";
import logger from "../logger";
import { BlockStubChain, IBlockStub } from "./blockStub";
import { BlockCache } from "./blockCache";
import { ReorgHeightListenerStore } from "./reorgHeightListener";
import { BlockProcessor } from "./blockProcessor";

/**
 * Keeps track of the current head of the blockchain, and handles reorgs up to the same depth maxDepth as the
 * BlockCache that is passed in the constructor.
 * Emits appropriate events when reorgs are observed, and resets the provider to the common ancestor (whenever possible)
 * so that appropriate block events are emitted.
 */
export class ReorgDetector extends StartStopService {
    private headBlock: BlockStubChain;
    private conductingReorg: boolean = false;

    public get maxDepth() {
        return this.blockCache.maxDepth;
    }

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
     * @param blockProcessor The BlockProcessor service
     * @param blockCache The BlockCache utility
     * @param store A store for reorg listeners
     */
    constructor(
        private readonly provider: ethers.providers.BaseProvider,
        private readonly blockProcessor: BlockProcessor,
        private readonly blockCache: BlockCache,
        public readonly store: ReorgHeightListenerStore
    ) {
        super("Reorg detector");

        this.handleNewBlock = this.handleNewBlock.bind(this);
        this.conductReorg = this.conductReorg.bind(this);
    }

    protected async startInternal(): Promise<void> {
        this.blockProcessor.on(BlockProcessor.NEW_HEAD_EVENT, this.handleNewBlock);
    }
    protected async stopInternal(): Promise<void> {
        this.blockProcessor.off(BlockProcessor.NEW_HEAD_EVENT, this.handleNewBlock);
    }

    /**
     * Detect a reorg if a new block is observed
     * @param blockNumber
     */
    private handleNewBlock(blockNumber: number, blockHash: string) {
        // If a reorg is in process, we ignore further blocks.
        // We will get up-to-date as soon as a new block is received after the reorg is complete.
        if (this.conductingReorg) return;

        try {
            // get the full block information for the incoming block
            const fullBlock = this.blockCache.getBlockStub(blockHash)!;

            if (!this.headBlock) {
                // no current block - start of operation
                this.headBlock = BlockStubChain.newRoot(fullBlock);
            } else if (fullBlock.parentHash === this.headBlock.hash) {
                // direct parent - extend the chain
                this.headBlock = this.headBlock.extend(fullBlock);
            } else {
                // if we couldn't extend this is a re-org, reset to the common ancestor
                const { commonAncestor, differenceBlocks } = this.findCommonAncestor(
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

                    // Start a reorg (asynchronous process)
                    this.conductReorg(BlockStubChain.newRoot(oldestBlock));
                } else {
                    // indirect ancestor found - conduct reorg
                    // Start a reorg (asynchronous process)
                    this.conductReorg(commonAncestor);
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
        }
    }

    /**
     * Updates local state according to a new head, and informs subscribers
     * @param newHead
     */
    private async conductReorg(newHead: BlockStubChain) {
        // We need to ignore further events until we are done with the reorg
        this.conductingReorg = true;

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

        this.conductingReorg = false;
    }

    /**
     * Since this reorg detector only detects reorgs below a max depth it can prune records
     * that it has below that
     */
    private prune() {
        // prune current re-org height listeners
        const minHeight = this.headBlock.height - this.maxDepth;
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
    public findCommonAncestorDeep(
        remoteBlockHash: string,
        localBlock: BlockStubChain,
        differenceBlocks: IBlockStub[],
        minHeight: number
    ): BlockStubChain | null {
        const blockRemote = this.blockCache.getBlockStub(remoteBlockHash);
        if (!blockRemote) return null;
        differenceBlocks.push(blockRemote);
        if (blockRemote.number <= minHeight) return null;

        const ancestor = localBlock.ancestorWithHash(blockRemote.parentHash);
        if (ancestor) return ancestor;

        return this.findCommonAncestorDeep(blockRemote.parentHash, localBlock, differenceBlocks, minHeight);
    }

    /**
     * Finds the common ancestor between a new block and the current head. Looks first shallowly, then
     * deep.BlockHeightListenerStore
     * @param newBlock
     * @param currentHead
     */
    public findCommonAncestor(
        newBlock: IBlockStub,
        currentHead: BlockStubChain,
        maxDepth: number
    ): { commonAncestor: BlockStubChain | null; differenceBlocks: IBlockStub[] } {
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
            commonAncestor = this.findCommonAncestorDeep(newBlock.parentHash, currentHead, differenceBlocks, minHeight);
        }

        return { commonAncestor, differenceBlocks };
    }

    /**
     * Add a listener for reorg events that reorg the chain to a common ancestor below a certain height. These events are guaranteed
     * to fire after ReorgDdetector.REORG_START_EVENT and before ReorgDetector.REORG_END_EVENT
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
