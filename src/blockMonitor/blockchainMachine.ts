import { BlockProcessor } from "./blockProcessor";
import { IBlockStub, StartStopService, ApplicationError } from "../dataEntities";
import { Component, AnchorState, ComponentAction, ComponentKind } from "./component";
import { BlockItemStore } from "../dataEntities/block";
import { Lock } from "../utils/lock";
const sub = require("subleveldown");

// Generic class to handle the anchor statee of a blockchain state machine
export class BlockchainMachine<TBlock extends IBlockStub> extends StartStopService {
    private components: Component<AnchorState, IBlockStub, ComponentAction>[] = [];

    // lock used to make sure that all events are processed in order
    private lock = new Lock();

    protected async startInternal(): Promise<void> {
        this.blockProcessor.addNewHeadListener(this.processNewHead);
        this.blockProcessor.addNewBlockListener(this.processNewBlock);
    }
    protected async stopInternal(): Promise<void> {
        // TODO: should detach events from BlockProcessor?
    }

    constructor(private blockProcessor: BlockProcessor<TBlock>, private blockItemStore: BlockItemStore) {
        super("blockchain-machine");
        this.processNewHead = this.processNewHead.bind(this);
        this.processNewBlock = this.processNewBlock.bind(this);
    }

    /**
     * Add a new `component` to the BlockchainMachine. It must be called before the service is started
     * @param component
     */
    public addComponent(component: Component<AnchorState, TBlock, ComponentAction>): void {
        if (this.started) {
            throw new ApplicationError("Components must be added before the BlockchainMachine is started.");
        }

        this.components.push(component);
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

                    if (parentBlock) {
                        prevHeadAnchorState = this.blockItemStore.getItem(parentBlock.hash, `${component.kind.toString()}:prevEmittedState`);
                    }

                    const prevAnchorState =
                        this.blockItemStore.getItem(parentBlock.hash, component.kind.toString()) || component.reducer.getInitialState(parentBlock);

                    newState = component.reducer.reduce(prevAnchorState, block);
                } else {
                    newState = component.reducer.getInitialState(block);
                }

                // states.set(block, newState);
                await this.blockItemStore.putBlockItem(block.number, block.hash, `${component.kind.toString()}:state`, newState);
                await this.blockItemStore.putBlockItem(block.number, block.hash, `${component.kind.toString()}:prevEmittedState`, prevHeadAnchorState);
            }
        } finally {
            this.lock.release();
        }
    }

    private async processNewHead(head: Readonly<TBlock>, prevHead: Readonly<TBlock> | null) {
        try {
            await this.lock.acquire();

            // The components can specify some behaviour that is computed as a diff
            // between the old head and the head. We compute this now for each of the
            // components

            for (const component of this.components) {
                const state: AnchorState = this.blockItemStore.getItem(head.hash, `${component.kind.toString()}:state`);
                if (state == undefined) {
                    // Since processNewBlock is always called before processNewHead, this should never happen
                    this.logger.error(
                        `State for component ${component.constructor.name} for block ${head.hash} (number ${head.number}) was not set, but it should have been.`
                    );
                    return;
                }

                // this is now the latest anchor stated for an emitted head block; update the store accordingly
                await this.blockItemStore.putBlockItem(head.number, head.hash, `${component.kind.toString()}:prevEmittedState`, state);

                const prevEmittedState: AnchorState | null = this.blockItemStore.getItem(head.hash, `${component.kind.toString()}:prevEmittedState`);

                if (prevEmittedState) {
                    const actions = component.detectChanges(prevEmittedState, state);
                    // side effects must be thread safe, so we can execute them concurrently
                    actions.forEach(a => component.applyAction(a));
                }
            }
        } finally {
            this.lock.release();
        }
    }
}
