import { ethers } from "ethers";
import { StartStopService, ApplicationError } from "../dataEntities";
import { IBlockStub } from "./blockStub";
import { ReorgHeightListenerStore } from "./reorgHeightListener";
import { BlockProcessor } from "./blockProcessor";
import { Lock } from "../utils/lock";

/**
 * Keeps track of the current head of the blockchain, and handles reorgs up to the same depth maxDepth as the
 * BlockCache that is passed in the constructor.
 * Emits appropriate events when reorgs are observed, and resets the provider to the common ancestor (whenever possible)
 * so that appropriate block events are emitted.
 */
export class ReorgDetector extends StartStopService {
    private headBlock: IBlockStub;

    private lock = new Lock();

    public get maxDepth() {
        return this.blockProcessor.blockCache.maxDepth;
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
        public readonly store: ReorgHeightListenerStore
    ) {
        super("reorg-detector");

        this.handleReorgEvent = this.handleReorgEvent.bind(this);
        this.handleNewHeadEvent = this.handleNewHeadEvent.bind(this);
        this.conductReorg = this.conductReorg.bind(this);
    }

    protected async startInternal(): Promise<void> {
        this.blockProcessor.on(BlockProcessor.REORG_EVENT, this.handleReorgEvent);
        this.blockProcessor.on(BlockProcessor.NEW_HEAD_EVENT, this.handleNewHeadEvent);
    }
    protected async stopInternal(): Promise<void> {
        this.blockProcessor.off(BlockProcessor.REORG_EVENT, this.handleReorgEvent);
        this.blockProcessor.off(BlockProcessor.NEW_HEAD_EVENT, this.handleNewHeadEvent);
    }

    private setNewHead(newHeadHash: string) {
        const newHeadBlock = this.blockProcessor.blockCache.getBlockStub(newHeadHash);
        if (!newHeadBlock) throw new ApplicationError(`BLock with hash ${newHeadHash} not found`);

        this.headBlock = newHeadBlock;
    }

    private async handleNewHeadEvent(blockNumber: number, blockHash: string) {
        // We enqueue the processing if there is a re-org in process
        await this.lock.acquire();

        this.setNewHead(blockHash);

        // prune events past the max depth after each event
        this.prune();

        this.lock.release();
    }

    /**
     * Detect a reorg if a new block is observed
     * @param blockNumber
     */
    private async handleReorgEvent(commonAncestorHash: string | null, newHeadHash: string, oldHeadHash: string) {
        // We enqueue the processing if there is a re-org in process
        await this.lock.acquire();

        try {
            if (commonAncestorHash === null) {
                // if we couldn't find a common ancestor the reorg must be too deep
                const newHeadBlock = this.blockProcessor.blockCache.getBlockStub(newHeadHash)!;
                this.emit(ReorgDetector.REORG_BEYOND_DEPTH_EVENT, this.headBlock, newHeadBlock);

                // find the oldest ancestor of the new head which is still in cache
                const oldestAncestor = this.blockProcessor.blockCache.getOldestAncestorInCache(newHeadHash);

                // Start a reorg (asynchronous process)
                await this.conductReorg(oldestAncestor);
            } else {
                // indirect ancestor found - conduct reorg

                // Start a reorg (asynchronous process)
                await this.conductReorg(this.blockProcessor.blockCache.getBlockStub(commonAncestorHash)!);
            }
            // prune events past the max depth after each event
            this.prune();
        } catch (doh) {
            this.logger.error("Unexpected error.");
            const dohError = doh as Error;
            if (dohError) {
                this.logger.error(dohError.stack!);
            }
        }

        this.lock.release();
    }

    /**
     * Updates local state according to a new head, and informs subscribers
     * @param newHead
     */
    private async conductReorg(newHead: IBlockStub) {
        // we found a commong ancestor that was not the head - therfore we need
        // to conduct a reorg. Inform other listeners so that they might pause their
        // processing in the meantime

        this.provider.polling = false;
        this.emit(ReorgDetector.REORG_START_EVENT, newHead.number);

        this.setNewHead(newHead.hash);

        // emit reorg listener events for everything above the ancestor
        // it's important that we emit all of these, and be sure that they've been
        // completed before turning polling back on so as to give listeners a chance
        // to add/remove listeners before we rewind.
        await this.emitReorgHeightEvents(newHead.number + 1);

        // reset this provider so that we can continue moving forward from here
        this.provider.resetEventsBlock(newHead.number + 1);

        // and emit the end reorg event
        this.emit(ReorgDetector.REORG_END_EVENT, newHead.number);
        this.provider.polling = true;
    }

    /**
     * Since this reorg detector only detects reorgs below a max depth it can prune records
     * that it has below that
     */
    private prune() {
        // prune current re-org height listeners
        const minHeight = this.headBlock.number - this.maxDepth;

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
        if (this.headBlock) return this.headBlock;
        else return null;
    }
}
