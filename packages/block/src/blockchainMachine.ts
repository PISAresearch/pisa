import { BlockProcessor } from "./blockProcessor";
import { IBlockStub } from "./block";
import { StartStopService, Lock, Logger } from "@pisa-research/utils";
import { ArgumentError } from "@pisa-research/errors";
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
        private readonly components: Component<AnchorState, TBlock, ComponentAction>[],
        private readonly logger: Logger
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
                this.logger.error({ err: doh, actionId: a.id, action: a.value, componentName: component.name }, "Failed to run action.");
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
     * Sets the state for the provided block for all components.
     * If the state of the parent is not present, it is computed by using `getInitialState` on the reducer. This should only happen at
     * startup. therefore, an error is logged if this happens after some previous anchor states were previously stored in the blockItemStore.
     * If the state of the parent is present, then the state for the current block is computed by using the `reduce` function of the reducer.
     * Once a new state is set changes are detected between this and the parent state, and actions are computed and executed.
     * This function writes to the blockItemStore and MUST be included in a batch to persist beyond memory.
     * @param block
     */
    public async setStateAndDetectChanges(block: TBlock) {
        if (!this.actionStore.started) this.logger.error("The ActionStore should be started before the BlockchainMachine is used.");
        if (!this.blockItemStore.started) this.logger.error("The BlockItemStore should be started before the BlockchainMachine is used.");

        // Every time a new block is received we calculate the anchor state for that block for each component and store it

        try {
            await this.lock.acquire();

            // For the first block only, there won't be any anchor state in the store. As we do the same for all the components,
            // we check blockItemStore.hasAnyAnchorStates only once at the beginning of the function.
            const isFirstAnchorState = !this.blockItemStore.hasAnyAnchorStates;

            for (const component of this.components) {
                if (isFirstAnchorState) {
                    // When the first block is fed to the blockchainMachine, no parent is available,
                    // therefore we compute the initial anchor state
                    const newAnchorState = await component.reducer.getInitialState(block);
                    this.blockItemStore.anchorState.set(component.name, block.number, block.hash, newAnchorState);
                } else {
                    // The parent state should definitely be available here, as it is not the first block processed

                    // get the parent state
                    const parentState = this.blockItemStore.anchorState.get<AnchorState>(component.name, block.parentHash);

                    let newAnchorState: AnchorState;
                    if (parentState == undefined) {
                        // This is a serious error, it should never happen
                        this.logger.error({ componentName: component.name }, "Did not find anchor state for component, but it was expected.");

                        // fallback to returning the initial state as best-effort resolution
                        newAnchorState = await component.reducer.getInitialState(block);
                    } else {
                        newAnchorState = await component.reducer.reduce(parentState, block);
                    }

                    this.blockItemStore.anchorState.set(component.name, block.number, block.hash, newAnchorState);

                    if (parentState != undefined) {
                        // having computed a new state we can detect changes and run actions
                        // for the difference between parent and now
                        const newActions = component.detectChanges(parentState, newAnchorState);
                        if (newActions.length > 0) {
                            const actionAndIds = await this.actionStore.storeItems(component.name, newActions);
                            this.runActionsForComponent(component, actionAndIds);
                        }
                    }
                }
            }
        } catch (doh) {
            this.logger.error({ error: doh }, "Unexpected error while setting anchor state.");
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
        this.machine = new BlockchainMachine(actionStore, blockItemStore, components, this.logger);
    }

    protected async startInternal(): Promise<void> {
        if (this.blockProcessor.started) this.logger.error("The BlockProcessor should be started after the BlockchainMachineService.");

        this.blockProcessor.newBlock.addListener(this.machine.setStateAndDetectChanges);
        // startup any actions that we had not completed
        this.machine.executeExistingActions();
    }

    protected async stopInternal(): Promise<void> {
        if (!this.blockProcessor.started) this.logger.error("The BlockProcessor should be stopped before the BlockchainMachineService.");

        this.blockProcessor.newBlock.removeListener(this.machine.setStateAndDetectChanges);
    }
}
