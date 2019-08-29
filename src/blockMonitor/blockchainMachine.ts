import { BlockProcessor } from "./blockProcessor";
import { IBlockStub, StartStopService, ApplicationError } from "../dataEntities";
import { Component, AnchorState, ComponentAction, ComponentKind } from "./component";
import { LevelUp } from "levelup";
import EncodingDown from "encoding-down";
const sub = require("subleveldown");

interface ComponentAndStates {
    component: Component<AnchorState, IBlockStub, ComponentAction>;
    states: WeakMap<IBlockStub, AnchorState>;
    actions: Set<ComponentAction>;
}

class BlockchainMachineStore {
    private readonly subDb: LevelUp<EncodingDown<string, any>>;
    constructor(db: LevelUp<EncodingDown<string, any>>) {
        this.subDb = sub(db, `blockchain-machine`, { valueEncoding: "json" });
    }

    public async storeActions(componentKind: ComponentKind, actions: ComponentAction[]) {
        let batch = this.subDb.batch();

        actions.forEach(a => {
            batch = batch.put(componentKind + ":" + (a as any).id, a);
        });

        await batch.write();
    }

    public async removeAction(componentKind: ComponentKind, action: ComponentAction) {
        await this.subDb.del(componentKind + ":" + (action as any).id);
    }

    public async storeAnchorState(componentKind: ComponentKind, blockHash: string, state: AnchorState) {
        await this.subDb.put(componentKind + ":" + blockHash, state);
    }
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

    constructor(private blockProcessor: BlockProcessor<TBlock>, private store: BlockchainMachineStore) {
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
            states: new WeakMap(),
            actions: new Set()
        });
    }

    private async processNewBlock(block: TBlock) {
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
            await this.store.storeAnchorState(component.kind, block.hash, newState);
        }
    }

    private async processNewHead(head: Readonly<TBlock>, prevHead: Readonly<TBlock> | null, synchronised: boolean) {
        // The components can specify some behaviour that is computed as a diff
        // between the old head and the head. We compute this now for each of the
        // components

        for (const { component, states, actions } of this.componentsAndStates) {
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
                    const detectedActions = component.detectChanges(prevState, state);
                    await this.store.storeActions(component.kind, detectedActions);
                    detectedActions.forEach(a => actions.add(a));
                }
            }

            if (synchronised) {
                // side effects must be thread safe, so we can execute them concurrently
                actions.forEach(async a => {
                    await component.applyAction(a);
                    actions.delete(a);
                    await this.store.removeAction(component.kind, a);
                });
            }
        }
    }
}
