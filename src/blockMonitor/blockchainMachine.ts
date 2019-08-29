import { BlockProcessor } from "./blockProcessor";
import { IBlockStub, StartStopService, ApplicationError } from "../dataEntities";
import { Component, AnchorState, ComponentAction, ComponentKind } from "./component";
import { LevelUp } from "levelup";
import EncodingDown from "encoding-down";
import { BlockItemStore } from "../dataEntities/block";
const sub = require("subleveldown");

interface ComponentAndStates {
    component: Component<AnchorState, IBlockStub, ComponentAction>;
    actions: Set<ComponentAction>;
}

class ActionStore extends StartStopService {
    private readonly subDb: LevelUp<EncodingDown<string, any>>;
    constructor(db: LevelUp<EncodingDown<string, any>>) {
        super("action-store")
        this.subDb = sub(db, `action-store`, { valueEncoding: "json" });
    }

    protected async startInternal() {
        // TODO: load actions from the db

    }
    protected async stopInternal() {}

    private actions: Map<ComponentKind, Set<ComponentAction>> = new Map();

    public async storeActions(componentKind: ComponentKind, actions: ComponentAction[]) {
        const componentSet = this.actions.get(componentKind);
        if(componentSet) actions.forEach(a => componentSet.add(a));
        else this.actions.set(componentKind, new Set(actions));

        let batch = this.subDb.batch();
        actions.forEach(a => (batch = batch.put(componentKind + ":" + (a as any).id, a)));
        await batch.write();
    }

    public async removeAction(componentKind: ComponentKind, action: ComponentAction) {
        const actions = this.actions.get(componentKind);
        if(!actions) return;
        else actions.delete(action);
        await this.subDb.del(componentKind + ":" + (action as any).id);
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

    constructor(
        private blockProcessor: BlockProcessor<TBlock>,
        private actionStore: ActionStore,
        private blockItemStore: BlockItemStore
    ) {
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
            actions: new Set()
        });
    }

    private async processNewBlock(block: TBlock) {
        // Every time a new block is received we calculate the anchor state for that block and store it

        for (const { component } of this.componentsAndStates) {
            // If the parent is available and its anchor state is known, the state can be computed with the reducer.
            // If the parent is available but its anchor state is not known, first compute its parent's initial state, then apply the reducer.
            // Finally, if the parent is not available at all in the block cache, compute the initial state based on the current block.

            let newState: AnchorState;
            if (this.blockProcessor.blockCache.hasBlock(block.parentHash)) {
                const parentBlock = this.blockProcessor.blockCache.getBlock(block.parentHash);
                const prevAnchorState =
                    this.blockItemStore.getItem(parentBlock.hash, component.kind.toString()) ||
                    component.reducer.getInitialState(parentBlock);

                newState = component.reducer.reduce(prevAnchorState, block);
            } else {
                newState = component.reducer.getInitialState(block);
            }

            // states.set(block, newState);
            await this.blockItemStore.putBlockItem(block.number, block.hash, component.kind.toString(), newState);
        }
    }

    private async processNewHead(head: Readonly<TBlock>, prevHead: Readonly<TBlock> | null, synchronised: boolean) {
        // The components can specify some behaviour that is computed as a diff
        // between the old head and the head. We compute this now for each of the
        // components

        for (const { component, actions } of this.componentsAndStates) {
            const state = this.blockItemStore.getItem(head.hash, component.kind.toString());
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
                const prevState = this.blockItemStore.getItem(prevHead.hash, component.kind.toString());
                if (prevState) {
                    const detectedActions = component.detectChanges(prevState, state);
                    await this.actionStore.storeActions(component.kind, detectedActions);
                    detectedActions.forEach(a => actions.add(a));
                }
            }

            if (synchronised) {
                // side effects must be thread safe, so we can execute them concurrently
                actions.forEach(async a => {
                    await component.applyAction(a);
                    actions.delete(a);
                    await this.actionStore.removeAction(component.kind, a);
                });
            }
        }
    }
}
