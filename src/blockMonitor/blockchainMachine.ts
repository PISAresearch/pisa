import { BlockProcessor } from "./blockProcessor";
import { IBlockStub, StartStopService, ApplicationError } from "../dataEntities";
import { Component, AnchorState, ComponentAction, ComponentKind } from "./component";
import { BlockItemStore } from "../dataEntities/block";
import { Lock } from "../utils/lock";

// Generic class to handle the anchor statee of a blockchain state machine
export class BlockchainMachine<TBlock extends IBlockStub> extends StartStopService {
    private components: Component<AnchorState, IBlockStub, ComponentAction>[] = [];
    private componentNames: Set<string> = new Set();

    // lock used to make sure that all events are processed in order
    private lock = new Lock();

    protected async startInternal(): Promise<void> {
        if (!this.blockProcessor.started) this.logger.error("The BlockchainMachine should be started before the BlockchainMachine.");
        if (!this.blockItemStore.started) this.logger.error("The BlockItemStore should be started before the BlockchainMachine.");

        this.blockProcessor.addNewHeadListener(this.processNewHead);
        this.blockProcessor.blockCache.addNewBlockListener(this.processNewBlock);
    }
    protected async stopInternal(): Promise<void> {
        this.blockProcessor.removeNewHeadListener(this.processNewHead);
        this.blockProcessor.blockCache.removeNewBlockListener(this.processNewBlock);
    }

    constructor(private blockProcessor: BlockProcessor<TBlock>, private blockItemStore: BlockItemStore<TBlock>) {
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
        console.log("BlockchainMachine processing new block:", block);
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

                    if (parentBlock) {
                        prevHeadAnchorState = this.blockItemStore.getItem(parentBlock.hash, `${component.name}:prevEmittedState`);
                    }

                    const prevAnchorState =
                        this.blockItemStore.getItem(parentBlock.hash, `${component.name}:state`) || component.reducer.getInitialState(parentBlock);

                    newState = component.reducer.reduce(prevAnchorState, block);
                } else {
                    newState = component.reducer.getInitialState(block);
                }

                // states.set(block, newState);
                await this.blockItemStore.putBlockItem(block.number, block.hash, `${component.name}:state`, newState);
                if (prevHeadAnchorState) {
                    await this.blockItemStore.putBlockItem(block.number, block.hash, `${component.name}:prevEmittedState`, prevHeadAnchorState);
                }
            }
        } finally {
            this.lock.release();
        }
    }

    private async processNewHead(head: Readonly<TBlock>) {
        console.log("BlockchainMachine processing new HEAD:", head);

        try {
            await this.lock.acquire();

            // The components can specify some behaviour that is computed as a diff
            // between the old head and the head. We compute this now for each of the
            // components

            for (const component of this.components) {
                const state: AnchorState = this.blockItemStore.getItem(head.hash, `${component.name}:state`);
                if (state == undefined) {
                    // Since processNewBlock is always called before processNewHead, this should never happen
                    this.logger.error(
                        `State for component ${component.constructor.name} for block ${head.hash} (number ${head.number}) was not set, but it should have been.`
                    );
                    return;
                }

                const prevEmittedState: AnchorState | null = this.blockItemStore.getItem(head.hash, `${component.name}:prevEmittedState`);

                // this is now the latest anchor stated for an emitted head block; update the store accordingly
                await this.blockItemStore.putBlockItem(head.number, head.hash, `${component.name}:prevEmittedState`, state);

                if (prevEmittedState) {
                    const actions = component.detectChanges(prevEmittedState, state);
                    // TODO: add back the ActionStore, store actions in db here

                    // side effects must be thread safe, so we can execute them concurrently
                    actions.forEach(a => component.applyAction(a));
                }
            }
        } finally {
            this.lock.release();
        }
    }
}
