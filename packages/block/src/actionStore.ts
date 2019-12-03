import { LevelUp } from "levelup";
import EncodingDown from "encoding-down";
const sub = require("subleveldown");
import uuid = require("uuid/v4");

import { StartStopService } from "@pisa-research/utils";

export interface ActionAndId<TAction> {
    id: string;
    action: TAction;
}

/** This class handles a subdatabase and stores entries that are sets of "actions" indexed by a string key. */
export class ActionStore<TAction> extends StartStopService {
    private readonly subDb: LevelUp<EncodingDown<string, any>>;
    private actions: Map<string, Set<ActionAndId<TAction>>> = new Map();

    /**
     * Creates a store inside db under the prefix `action-store-${name}`.
     * @param db
     * @param name
     */
    constructor(db: LevelUp<EncodingDown<string, any>>, name: string) {
        super(`action-store-${name}`);
        this.subDb = sub(db, `action-store-${name}`, { valueEncoding: "json" });
    }

    protected async startInternal() {
        // load existing actions from the db
        for await (const record of this.subDb.createReadStream()) {
            const { key: dbKey, value } = (record as any) as { key: string; value: TAction };

            const i = dbKey.indexOf(":");
            const key = dbKey.substring(0, i);
            const actionId = dbKey.substring(i + 1);

            const actionWithId = { id: actionId, action: value };

            const keyActions = this.actions.get(key);
            if (keyActions) keyActions.add(actionWithId);
            else this.actions.set(key, new Set([actionWithId]));
        }
    }
    protected async stopInternal() {}

    /** Returns all the actions stored for `key`. */
    public getActions(key: string) {
        return this.actions.get(key) || new Set();
    }

    /**
     * Adds `actions` to the actions stored for `key`, after wrapping each action with a unique `id`.
     * @returns the array of wrapped actions.
     */
    public async storeActions(key: string, actions: TAction[]): Promise<ActionAndId<TAction>[]> {
        // we forge unique ids for actions to uniquely distinguish them in the db
        const actionsWithId = actions.map(a => ({ id: uuid(), action: a }));

        // DB
        let batch = this.subDb.batch();
        actionsWithId.forEach(({ id, action }) => {
            batch = batch.put(key + ":" + id, action);
        });
        await batch.write();

        // MEMORY
        const keySet = this.actions.get(key);
        if (keySet) actionsWithId.forEach(a => keySet.add(a));
        else this.actions.set(key, new Set(actionsWithId));

        return actionsWithId;
    }

    /** Removes the action contained in `actionAndId`  */
    public async removeAction(key: string, actionAndId: ActionAndId<TAction>) {
        // DB
        await this.subDb.del(key + ":" + actionAndId.id);
        
        // MEMORY
        const actions = this.actions.get(key);
        if (!actions) return;
        else actions.delete(actionAndId);
    }
}
