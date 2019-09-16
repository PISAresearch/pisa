import { BlockProcessor } from "./blockProcessor";
import { IBlockStub, StartStopService, ApplicationError } from "../dataEntities";
import { Component, AnchorState, ComponentAction } from "./component";
import { ActionStore, ActionAndId } from "./actionStore";
import { BlockItemStore } from "../dataEntities/block";
import { Lock } from "../utils/lock";

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
     * from the ActionStore upon completion.s
     */
    private runActionsForComponent(component: Component<AnchorState, IBlockStub, ComponentAction>, actionAndIds: Iterable<ActionAndId>) {
        // Side effects must be thread safe, so we can execute them concurrently
        // Note that actions are executed in background and not awaited for in here.
        [...actionAndIds].forEach(async a => {
            try {
                await component.applyAction(a.action);
                await this.actionStore.removeAction(component.name, a);
            } catch(doh) {
                this.logger.error(doh);
            }
        });
    }

    protected async startInternal(): Promise<void> {
        if (!this.blockProcessor.started) this.logger.error("The BlockProcessor should be started before the BlockchainMachine.");
        if (!this.actionStore.started) this.logger.error("The ActionStore should be started before the BlockchainMachine.");
        if (!this.blockItemStore.started) this.logger.error("The BlockItemStore should be started before the BlockchainMachine.");

        this.blockProcessor.newHead.addListener(this.processNewHead);
        this.blockProcessor.blockCache.newBlock.addListener(this.processNewBlock);

        // For each component, load and start any action that was stored in the ActionStore
        for (const component of this.components) {
            const actionAndIds = this.actionStore.getActions(component.name);
            this.runActionsForComponent(component, actionAndIds);
        }
    }

    protected async stopInternal(): Promise<void> {
        this.blockProcessor.newHead.removeListener(this.processNewHead);
        this.blockProcessor.blockCache.newBlock.removeListener(this.processNewBlock);
    }

    constructor(private blockProcessor: BlockProcessor<TBlock>, private actionStore: ActionStore, private blockItemStore: BlockItemStore<TBlock>) {
        super("blockchain-machine");
        this.processNewHead = this.processNewHead.bind(this);
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
                // If the parent is available and its anchor state is known, the state can be computed with the reducer.
                // If the parent is available but its anchor state is not known, first compute its parent's initial state, then apply the reducer.
                // Finally, if the parent is not available at all in the block cache, compute the initial state based on the current block.

                let newState: AnchorState;
                let prevHeadAnchorState: AnchorState | null = null;
                if (this.blockProcessor.blockCache.hasBlock(block.parentHash)) {
                    const parentBlock = this.blockProcessor.blockCache.getBlock(block.parentHash);

                    prevHeadAnchorState = this.blockItemStore.prevEmittedAnchorState.get(component.name, parentBlock.hash);

                    const prevAnchorState =
                        this.blockItemStore.anchorState.get<AnchorState>(component.name, parentBlock.hash) ||
                        component.reducer.getInitialState(parentBlock); // prettier-ignore

                    newState = component.reducer.reduce(prevAnchorState, block);
                } else {
                    newState = component.reducer.getInitialState(block);
                }

                await this.blockItemStore.anchorState.set(component.name, block.number, block.hash, newState);
                if (prevHeadAnchorState) {
                    // copy prevEmittedAnchorState from the previous block
                    await this.blockItemStore.prevEmittedAnchorState.set(component.name, block.number, block.hash, prevHeadAnchorState);
                }
            }
        } finally {
            this.lock.release();
        }
    }

    private async processNewHead(head: Readonly<TBlock>) {
        try {
            await this.lock.acquire();

            // The components can specify some behaviour that is computed as a diff
            // between the old head and the head. We compute this now for each of the
            // components

            for (const component of this.components) {
                const state: AnchorState = this.blockItemStore.anchorState.get(component.name, head.hash);
                if (state == undefined) {
                    // Since processNewBlock is always called before processNewHead, this should never happen
                    this.logger.error(
                        `State for component ${component.constructor.name} for block ${head.hash} (number ${head.number}) was not set, but it should have been.`
                    );
                    return;
                }

                const prevEmittedState: AnchorState | null = this.blockItemStore.prevEmittedAnchorState.get(component.name, head.hash);

                // this is now the latest anchor stated for an emitted head block; update the store accordingly
                await this.blockItemStore.prevEmittedAnchorState.set(component.name, head.number, head.hash, state);

                if (prevEmittedState) {
                    // save actions in the store
                    const newActions = component.detectChanges(prevEmittedState, state);
                    if (newActions.length > 0) {
                        const actionAndIds = await this.actionStore.storeActions(component.name, newActions);
                        this.runActionsForComponent(component, actionAndIds);
                    }
                }
            }
        } finally {
            this.lock.release();
        }
    }
}
