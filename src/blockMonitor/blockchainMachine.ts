import { BlockProcessor } from "./blockProcessor";
import { IBlockStub, StartStopService, ApplicationError } from "../dataEntities";
import { Component, AnchorState, ComponentAction } from "./component";
import { BlockItemStore } from "../dataEntities/block";
import { Lock } from "../utils/lock";

import { LevelUp } from "levelup";
import EncodingDown from "encoding-down";
const sub = require("subleveldown");
import uuid = require("uuid/v4");

export interface ActionAndId {
    id: string;
    action: ComponentAction;
}

export class ActionStore extends StartStopService {
    private readonly subDb: LevelUp<EncodingDown<string, any>>;
    private actions: Map<string, Set<ActionAndId>> = new Map();

    constructor(db: LevelUp<EncodingDown<string, any>>) {
        super("action-store");
        this.subDb = sub(db, `action-store`, { valueEncoding: "json" });
    }

    protected async startInternal() {
        // load existing actions from the db
        for await (const record of this.subDb.createReadStream()) {
            const { key, value } = (record as any) as { key: string; value: ComponentAction };

            const i = key.indexOf(":");
            const componentName = key.substring(0, i);
            const actionId = key.substring(i + 1);

            const actionWithId = { id: actionId, action: value };

            const componentActions = this.actions.get(componentName);
            if (componentActions) componentActions.add(actionWithId);
            else this.actions.set(componentName, new Set([actionWithId]));
        }
    }
    protected async stopInternal() {}

    public getActions(componentName: string) {
        return this.actions.get(componentName) || new Set();
    }

    public async storeActions(componentName: string, actions: ComponentAction[]) {
        // we forge unique ids for actions to uniquely distinguish them in the db
        const actionsWithId = actions.map(a => ({ id: uuid(), action: a }));

        const componentSet = this.actions.get(componentName);
        if (componentSet) actionsWithId.forEach(a => componentSet.add(a));
        else this.actions.set(componentName, new Set(actionsWithId));

        let batch = this.subDb.batch();
        actionsWithId.forEach(actionWithId => {
            batch = batch.put(componentName + ":" + actionWithId.id, actionWithId.action);
        });
        await batch.write();
    }

    public async removeAction(componentName: string, actionAndId: ActionAndId) {
        const actions = this.actions.get(componentName);
        if (!actions) return;
        else actions.delete(actionAndId);
        await this.subDb.del(componentName + ":" + actionAndId.id);
    }
}

// Generic class to handle the anchor statee of a blockchain state machine
export class BlockchainMachine<TBlock extends IBlockStub> extends StartStopService {
    private components: Component<AnchorState, IBlockStub, ComponentAction>[] = [];
    private componentNames: Set<string> = new Set();

    // lock used to make sure that all events are processed in order
    private lock = new Lock();

    protected async startInternal(): Promise<void> {
        if (!this.blockProcessor.started) this.logger.error("The BlockchainMachine should be started before the BlockchainMachine.");
        if (!this.actionStore.started) this.logger.error("The ActionStore should be started before the BlockchainMachine.");
        if (!this.blockItemStore.started) this.logger.error("The BlockItemStore should be started before the BlockchainMachine.");

        this.blockProcessor.addNewHeadListener(this.processNewHead);
        this.blockProcessor.blockCache.addNewBlockListener(this.processNewBlock);
    }
    protected async stopInternal(): Promise<void> {
        this.blockProcessor.removeNewHeadListener(this.processNewHead);
        this.blockProcessor.blockCache.removeNewBlockListener(this.processNewBlock);
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

                    prevHeadAnchorState = this.blockItemStore.getItem(parentBlock.hash, `${component.name}:prevEmittedState`);

                    const prevAnchorState =
                        this.blockItemStore.getItem(parentBlock.hash, `${component.name}:state`) || component.reducer.getInitialState(parentBlock);

                    newState = component.reducer.reduce(prevAnchorState, block);
                } else {
                    newState = component.reducer.getInitialState(block);
                }

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
                    // save actions in the store
                    const newActions = component.detectChanges(prevEmittedState, state);
                    if (newActions.length > 0) await this.actionStore.storeActions(component.name, newActions);

                    // load all the actions (might include oldler actions; also, they now have id)
                    const actionAndIds = this.actionStore.getActions(component.name);

                    // side effects must be thread safe, so we can execute them concurrently
                    actionAndIds.forEach(async a => {
                        await component.applyAction(a.action);
                        this.actionStore.removeAction(component.name, a);
                    });
                }
            }
        } finally {
            this.lock.release();
        }
    }
}
