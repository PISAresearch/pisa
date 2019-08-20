import { BlockProcessor } from "./blockProcessor";
import { IBlockStub, StartStopService, ApplicationError } from "../dataEntities";
import { Component, AnchorState, ComponentAction } from "./component";

interface ComponentAndStates {
    component: Component<AnchorState, IBlockStub, ComponentAction>;
    states: WeakMap<IBlockStub, AnchorState>;
}

// Generic class to handle the anchor statee of a blockchain state machine
export class BlockchainMachine<TBlock extends IBlockStub> extends StartStopService {
    private componentsAndStates: ComponentAndStates[] = [];

    protected async startInternal(): Promise<void> {
        this.blockProcessor.on(BlockProcessor.NEW_HEAD_EVENT, this.processNewHead);
        this.blockProcessor.on(BlockProcessor.NEW_BLOCK_EVENT, this.processNewBlock);
    }
    protected async stopInternal(): Promise<void> {
        this.blockProcessor.off(BlockProcessor.NEW_HEAD_EVENT, this.processNewHead);
        this.blockProcessor.off(BlockProcessor.NEW_BLOCK_EVENT, this.processNewBlock);
    }

    constructor(private blockProcessor: BlockProcessor<TBlock>) {
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

        this.componentsAndStates.push({
            component,
            states: new WeakMap()
        });
    }

    private processNewBlock(block: TBlock) {
        // Every time a new block is received we calculate the anchor state for that block and store it

        for (const { component, states } of this.componentsAndStates) {
            // If the parent is available and its anchor state is known, the state can be computed with the reducer.
            // If the parent is available but its anchor state is not known, first compute its parent's initial state, then apply the reducer.
            // Finally, if the parent is not available at all in the block cache, compute the initial state based on the current block.

            let newState: AnchorState;
            if (this.blockProcessor.blockCache.hasBlock(block.parentHash)) {
                const parentBlock = this.blockProcessor.blockCache.getBlock(block.parentHash);
                const prevAnchorState = states.get(parentBlock) || component.reducer.getInitialState(parentBlock);

                newState = component.reducer.reduce(prevAnchorState, block);
            } else {
                newState = component.reducer.getInitialState(block);
            }

            states.set(block, newState);
        }
    }

    private processNewHead(head: Readonly<TBlock>, prevHead: Readonly<TBlock> | null) {
        // The components can specify some behaviour that is computed as a diff
        // between the old head and the head. We compute this now for each of the
        // components

        for (const { component, states } of this.componentsAndStates) {
            const state = states.get(head);
            if (state == undefined) {
                // Since processNewBlock is always called before processNewHead, this should never happen
                this.logger.error(
                    `State for component ${component.constructor.name} for block ${head.hash} (number ${
                        head.number
                    }) was not set, but it should have been.`
                );
                return;
            }
            if (prevHead) {
                const prevState = states.get(prevHead);
                if (prevState) {
                    const actions = component.detectChanges(prevState, state);
                    // side effects must be thread safe, so we can execute them concurrently
                    actions.forEach(a => component.applyAction(a));
                }
            }
        }
    }
}
