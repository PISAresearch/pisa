import { LevelUp } from "levelup";
import EncodingDown from "encoding-down";
const sub = require("subleveldown");
import uuid = require("uuid/v4");
import { ComponentAction } from "./component";
import { StartStopService } from "@pisa-research/utils";


export interface ActionAndId {
    id: string;
    action: ComponentAction;
}

/** This class stores the actions for each component in the database. */
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

    /** Returns all the actions stored for `componentName`. */
    public getActions(componentName: string) {
        return this.actions.get(componentName) || new Set();
    }

    /**
     * Adds `actions` to the actions stored for `componentName`, after wrapping each action with a unique `id`.
     * @returns the array of wrapped actions.
     */
    public async storeActions(componentName: string, actions: ComponentAction[]): Promise<ActionAndId[]> {
        // we forge unique ids for actions to uniquely distinguish them in the db
        const actionsWithId = actions.map(a => ({ id: uuid(), action: a }));

        // DB
        let batch = this.subDb.batch();
        actionsWithId.forEach(({ id, action }) => {
            batch = batch.put(componentName + ":" + id, action);
        });
        await batch.write();

        // MEMORY
        const componentSet = this.actions.get(componentName);
        if (componentSet) actionsWithId.forEach(a => componentSet.add(a));
        else this.actions.set(componentName, new Set(actionsWithId));

        return actionsWithId;
    }

    /** Removes the action contained in `actionAndId`  */
    public async removeAction(componentName: string, actionAndId: ActionAndId) {
        // DB
        await this.subDb.del(componentName + ":" + actionAndId.id);
        
        // MEMORY
        const actions = this.actions.get(componentName);
        if (!actions) return;
        else actions.delete(actionAndId);
        
    }
}
