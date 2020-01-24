import { BlockProcessor } from "./blockProcessor";
import { IBlockStub } from "./block";
import { StartStopService, Lock, logger } from "@pisa-research/utils";
import { ConfigurationError, ArgumentError } from "@pisa-research/errors";
import { Component, AnchorState, ComponentAction } from "./component";
import { CachedKeyValueStore, ItemAndId } from "./cachedKeyValueStore";
import { BlockItemStore } from "./blockItemStore";

/**
 * Blockchain machine functionality
 */
export class BlockchainMachine<TBlock extends IBlockStub> {
    // lock used to make sure that all events are processed in order
    private lock = new Lock();

    /**
     * 
     * @param actionStore 
     * @param blockItemStore 
     * @param components We compute an O(n^2) operation on startup, so care should be take if adding a great many components
     */
    constructor(
        private readonly actionStore: CachedKeyValueStore<ComponentAction>,
        public readonly blockItemStore: BlockItemStore<TBlock>,
        private readonly components: Component<AnchorState, TBlock, ComponentAction>[]
    ) {
        const duplicateNames = components.map(c => c.name).filter((n, i) => components.map(c => c.name).lastIndexOf(n) !== i);
        if (duplicateNames.length !== 0) throw new ArgumentError(`Duplicate component names were supplied.`, duplicateNames[0]);

        this.setStateAndDetectChanges = this.setStateAndDetectChanges.bind(this);
    }

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
                logger.error(doh);
            }
        });
    }

    /**
     * Finds any existing actions in the store and executes them.
     */
    public executeExistingActions() {
        for (const component of this.components) {
            const actionAndIds = this.actionStore.getItems(component.name);
            this.runActionsForComponent(component, actionAndIds);
        }
    }

    /**
     * Sets a state for a block whose parent may not already be in the block item store.
     * If the parent is in the store reduce is used to compute the next state, if it is not the getInitialState is
     * called on the component reducer.
     * This function writes to the blockItemStore and MUST be included in a batch to persist beyond memory.
     * @param block
     */
    public async setInitialState(block: TBlock): Promise<void> {
        if (!this.actionStore.started) logger.error("The actionStore should be started before the BlockchainMachine is used.");
        if (!this.blockItemStore.started) logger.error("The BlockItemStore should be started before the BlockchainMachine is used.");

        try {
            await this.lock.acquire();
            // For each component, load and start any action that was stored in the actionStore
            for (const component of this.components) {
                // if the current state is not already in the store we need to compute it and set it there
                if (!this.blockItemStore.anchorState.get<AnchorState>(component.name, block.hash)) {
                    const parentAnchorState = this.blockItemStore.anchorState.get<AnchorState>(component.name, block.parentHash);
                    const newAnchorState = parentAnchorState
                        ? await component.reducer.reduce(parentAnchorState, block)
                        : await component.reducer.getInitialState(block);

                    this.blockItemStore.anchorState.set(component.name, block.number, block.hash, newAnchorState);
                }
            }
        } finally {
            this.lock.release();
        }
    }

    /**
     * Sets the state for the provided block for all components. The states for the parent blocks must already have been set.
     * either with setInitialState or with this function.
     * Once a new state is set changes are detected between this and the parent state, and actions are computed and executed.
     * This function writes to the blockItemStore and MUST be included in a batch to persist beyond memory.
     * @param block
     */
    public async setStateAndDetectChanges(block: TBlock) {
        if (!this.actionStore.started) logger.error("The actionStore should be started before the BlockchainMachine is used.");
        if (!this.blockItemStore.started) logger.error("The BlockItemStore should be started before the BlockchainMachine is used.");
        
        try {
            await this.lock.acquire();

            // Every time a new block is received we calculate the anchor state for that block and store it
            for (const component of this.components) {
                // get the parent
                const parentState = this.blockItemStore.anchorState.get<AnchorState>(component.name, block.parentHash);
                if (!parentState) throw new ConfigurationError(`Parent state not already set for component: ${component.name} block: ${block.number - 1}:${block.parentHash}`); //prettier-ignore

                // reduce the new state
                const newAnchorState = await component.reducer.reduce(parentState, block);
                this.blockItemStore.anchorState.set(component.name, block.number, block.hash, newAnchorState);

                // having computed a new state we can detect changes and run actions
                // for the difference between parent and now
                const newActions = component.detectChanges(parentState, newAnchorState);
                if (newActions.length > 0) {
                    const actionAndIds = await this.actionStore.storeItems(component.name, newActions);
                    this.runActionsForComponent(component, actionAndIds);
                }
            }
        } finally {
            this.lock.release();
        }
    }
}

/**
 * Generic class to handle the anchor state of a blockchain state machine.
 *
 * For each block that is added to the cache (and for each added component), this will compute the new anchor state for
 * that component. This class will also use the component's `detectChanges`
 * function to compute the appropriate actions, by comparing the newly computed anchor state with the anchor state of the
 * closest ancestor that was emitted.
 */
export class BlockchainMachineService<TBlock extends IBlockStub> extends StartStopService {
    private readonly machine: BlockchainMachine<TBlock>;

    constructor(
        private readonly blockProcessor: BlockProcessor<TBlock>,
        actionStore: CachedKeyValueStore<ComponentAction>,
        blockItemStore: BlockItemStore<TBlock>,
        components: Component<AnchorState, TBlock, ComponentAction>[]
    ) {
        super("blockchain-machine");
        this.machine = new BlockchainMachine(actionStore, blockItemStore, components);
    }

    protected async startInternal(): Promise<void> {
        if (!this.blockProcessor.started) this.logger.error("The BlockProcessor should be started before the BlockchainMachineService.");

        this.blockProcessor.newBlock.addListener(this.machine.setStateAndDetectChanges);

        // normally batching is handled in the block processor but not in startup
        await this.machine.blockItemStore.withBatch(async () => {
            await this.machine.setInitialState(this.blockProcessor.blockCache.head);
        });

        // startup any actions that we had not completed
        this.machine.executeExistingActions();
    }

    protected async stopInternal(): Promise<void> {
        this.blockProcessor.newBlock.removeListener(this.machine.setStateAndDetectChanges);
    }
}
