import "mocha";
import { expect } from "chai";
import { ActionStore } from "../src/actionStore";
import LevelUp from "levelup";
import EncodingDown from "encoding-down";
import MemDown from "memdown";
import { fnIt } from "@pisa-research/test-utils";


type TestAction = {
    name: string;
}

describe("ActionStore", () => {
    let actionStore: ActionStore<TestAction>;
    let db: any;

    const key = "awesome-component";
    const testActions: TestAction[] = [
        {
            name: "action1"
        },
        {
            name: "action2"
        }
    ];

    beforeEach(async () => {
        db = LevelUp(EncodingDown<string, any>(MemDown(), { valueEncoding: "json" }));
        actionStore = new ActionStore(db, "prefix");
        await actionStore.start();
    });

    afterEach(async () => {
        if (actionStore.started) await actionStore.stop();
    });

    it("can store an retrieve some actions", async () => {
        await actionStore.storeActions(key, testActions);

        const retrievedActions = [...actionStore.getActions(key)].map(a => a.action);
        expect(retrievedActions).to.deep.equal(testActions);
    });

    fnIt<ActionStore<object>>(a => a.storeActions, "returns wrapped all the wrapped actions and ids", async () => {
        const actionsAndIds = await actionStore.storeActions(key, testActions);

        expect(testActions.length).to.equal(actionsAndIds.length);
        for (let i = 0; i < testActions.length; i++) {
            expect(actionsAndIds[i].action).to.deep.equal(testActions[i]);
        }
    });

    fnIt<ActionStore<object>>(a => a.removeAction, "removes an action", async () => {
        await actionStore.storeActions(key, testActions);

        const retrievedActionsAndId = [...actionStore.getActions(key)];

        await actionStore.removeAction(key, retrievedActionsAndId[0]); // delete the first action

        const retrievedActionsAfter = [...actionStore.getActions(key)].map(a => a.action);
        expect(retrievedActionsAfter).to.deep.equal([testActions[1]]); // should only contain the second action
    });

    it("reloads actions from the db on startup", async () => {
        await actionStore.storeActions(key, testActions);
        await actionStore.stop();

        const newActionStore = new ActionStore(db, "prefix"); // a new ActionStore on the same db
        await newActionStore.start();

        const retrievedActions = [...newActionStore.getActions(key)]
            .map(a => a.action) // prettier-ignore
            .sort((a, b) => ((a as any).name < (b as any).name ? -1 : 1)); // make sure they are checked in the same order

        await newActionStore.stop();

        expect(retrievedActions).to.deep.equal(testActions);
    });

    fnIt<ActionStore<object>>(a => a.removeAction, "removes an action also removes a function from the db", async () => {
        // make sure that deleted functions are also deleted from the db, and not just locally

        await actionStore.storeActions(key, testActions);
        const retrievedActionsAndId = [...actionStore.getActions(key)];

        await actionStore.removeAction(key, retrievedActionsAndId[0]); // delete the first action

        await actionStore.stop();

        const newActionStore = new ActionStore(db, "prefix"); // a new ActionStore on the same db
        await newActionStore.start();

        const retrievedActionsAfter = [...newActionStore.getActions(key)].map(a => a.action);
        await newActionStore.stop();
        expect(retrievedActionsAfter).to.deep.equal([testActions[1]]); // should only contain the second action
    });
});
