import { BlockProcessor } from "./blockProcessor";
import { IBlockStub, StartStopService, ApplicationError } from "../dataEntities";
import { Component } from "./component";

interface ComponentAndStates {
    component: Component<{}, IBlockStub>;
    states: WeakMap<IBlockStub, {}>;
}

// Generic class to handle the anchor statee of a blockchain state machine
export class BlockchainMachine<TBlock extends IBlockStub> extends StartStopService {
    private componentsAndStates: ComponentAndStates[] = [];

    protected async startInternal(): Promise<void> {
        this.blockProcessor.on(BlockProcessor.NEW_HEAD_EVENT, this.processNewHead);
    }
    protected async stopInternal(): Promise<void> {
        this.blockProcessor.off(BlockProcessor.NEW_HEAD_EVENT, this.processNewHead);
    }

    constructor(private blockProcessor: BlockProcessor<TBlock>) {
        super("blockchain-machine");
        this.processNewHead = this.processNewHead.bind(this);
    }

    /**
     * Add a new `component` to the BlockchainMachine. It must be called before the service is started
     * @param component
     */
    public addComponent(component: Component<{}, TBlock>): void {
        if (this.started) {
            throw new ApplicationError("Components must be added before the BlockchainMachine is started.");
        }

        this.componentsAndStates.push({
            component,
            states: new WeakMap()
        });
    }

    private processNewHead(head: Readonly<TBlock>, prevHead: Readonly<TBlock> | null) {
        // Make the list of ancestors up to (and excluding) prevHead;
        // put all the ancestry if prevHead is null
        const ancestorsToAdd: Readonly<TBlock>[] = [];
        for (const block of this.blockProcessor.blockCache.ancestry(head.hash)) {
            if (prevHead && block.hash === prevHead.hash) break;
            ancestorsToAdd.push(block);
        }

        // start from the oldest, compute each block's state
        ancestorsToAdd.reverse();

        // for each component, compute the new states and emit a "new state" event if necessary
        for (const { component, states } of this.componentsAndStates) {
            let state: object | null = null;
            for (const block of ancestorsToAdd) {
                let prevAnchorState: object | undefined;
                if (this.blockProcessor.blockCache.hasBlock(block.parentHash)) {
                    const parentBlock = this.blockProcessor.blockCache.getBlockStub(block.parentHash);
                    prevAnchorState = states.get(parentBlock) || component.reducer.getInitialState(parentBlock);

                    state = component.reducer.reduce(prevAnchorState, block);
                } else {
                    state = component.reducer.getInitialState(block);
                }

                states.set(block, state);
            }

            if (state && prevHead) {
                const prevState = prevHead && states.get(prevHead);
                if (prevState != null) {
                    // TODO:198: should we (deeply) compare old state and new state and only emit if different?
                    // Probably not, it might be expensive/inefficient depending on what is in TState
                    component.handleNewStateEvent(prevHead, prevState, head, state);
                }
            }
        }
    }
}
