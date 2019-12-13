import { BlockProcessor } from "./blockProcessor";
import { IBlockStub } from "./block";
import { StartStopService, Lock } from "@pisa-research/utils";
import { ApplicationError } from "@pisa-research/errors";
import { Component, AnchorState, ComponentAction } from "./component";
import { CachedKeyValueStore, ItemAndId } from "./cachedKeyValueStore";
import { BlockItemStore } from "./blockItemStore";

/**
 * Generic class to handle the anchor state of a blockchain state machine.
 *
 * For each block that is added to the cache (and for each added component), this will compute the new anchor state for
 * that component. Moreover, every time a "new head" event is emitted, this class will use the component's `detectChanges`
 * function to compute the appropriate actions, by comparing the newly computed anchor state with the anchor state of the
 * closest ancestor that was emitted as "new head". Since the latter might no longer be in the BlockCache, its anchor state
 * is propagated in each subsequent block; thus, every block stores its anchor state, and the "closest emitted ancestor"'s one.
 */
export class BlockchainMachine<TBlock extends IBlockStub> extends StartStopService {
    private components: Component<AnchorState, IBlockStub, ComponentAction>[] = [];
    private componentNames: Set<string> = new Set();

    // lock used to make sure that all events are processed in order
    private lock = new Lock();

    /**
     * Runs all the actions in `actionAndIds` for `component`. Actions are all executed in parallel, and each action is removed
     * from the actionStore upon completion.
     */
    private runActionsForComponent(component: Component<AnchorState, IBlockStub, ComponentAction>, actionAndIds: Iterable<ItemAndId<ComponentAction>>) {
        // Side effects must be thread safe, so we can execute them concurrently
        // Note that actions are executed in background and not awaited for in here.
        [...actionAndIds].forEach(async a => {
            try {
                await component.applyAction(a.value);
                await this.actionStore.removeItem(component.name, a);
            } catch (doh) {
                this.logger.error(doh);
            }
        });
    }

    protected async startInternal(): Promise<void> {
        if (!this.blockProcessor.started) this.logger.error("The BlockProcessor should be started before the BlockchainMachine.");
        if (!this.actionStore.started) this.logger.error("The actionStore should be started before the BlockchainMachine.");
        if (!this.blockItemStore.started) this.logger.error("The BlockItemStore should be started before the BlockchainMachine.");

        this.blockProcessor.newBlock.addListener(this.processNewBlock);

        // For each component, load and start any action that was stored in the actionStore
        for (const component of this.components) {
            const actionAndIds = this.actionStore.getItems(component.name);
            this.runActionsForComponent(component, actionAndIds);
        }
    }

    protected async stopInternal(): Promise<void> {
        this.blockProcessor.newBlock.removeListener(this.processNewBlock);
    }

    constructor(
        private blockProcessor: BlockProcessor<TBlock>,
        private actionStore: CachedKeyValueStore<ComponentAction>,
        private blockItemStore: BlockItemStore<TBlock>
    ) {
        super("blockchain-machine");
        this.processNewBlock = this.processNewBlock.bind(this);
    }

    /**
     * Add a new `component` to the BlockchainMachine. It must be called before the service is started
     * @param component
     */
    public addComponent(component: Component<AnchorState, TBlock, ComponentAction>): void {
        if (this.started) throw new ApplicationError("Components must be added before the BlockchainMachine is started.");
        if (this.componentNames.has(component.name)) throw new ApplicationError(`A Component with the name "${component.name}" was already added.`);

        this.components.push(component);
        this.componentNames.add(component.name);
    }

    private async processNewBlock(block: TBlock) {
        try {
            await this.lock.acquire();

            // Every time a new block is received we calculate the anchor state for that block and store it
            for (const component of this.components) {
                if (this.blockProcessor.blockCache.hasBlock(block.parentHash)) {
                    const prevAnchorState =
                        // If the parent is available and its anchor state is known, the state can be computed with the reducer.
                        this.blockItemStore.anchorState.get<AnchorState>(component.name, block.parentHash) ||
                        // If the parent is available but its anchor state is not known, first compute its parent's initial state, then apply the reducer.
                        await component.reducer.getInitialState(this.blockProcessor.blockCache.getBlock(block.parentHash));

                    const newAnchorState = await component.reducer.reduce(prevAnchorState, block);
                    this.blockItemStore.anchorState.set(component.name, block.number, block.hash, newAnchorState);

                    // having computed a new state we can detect changes and run actions 
                    // for the difference between then and now
                    const newActions = component.detectChanges(prevAnchorState, newAnchorState);
                    if (newActions.length > 0) {
                        const actionAndIds = await this.actionStore.storeItems(component.name, newActions);
                        this.runActionsForComponent(component, actionAndIds);
                    }
                }
                // Finally, if the parent is not available at all in the block cache, compute the initial state based on the current block.
                else {
                    const newAnchorState = await component.reducer.getInitialState(block);
                    this.blockItemStore.anchorState.set(component.name, block.number, block.hash, newAnchorState);
                }
            }
        } finally {
            this.lock.release();
        }
    }
}
