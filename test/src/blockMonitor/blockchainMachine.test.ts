import "mocha";
import { expect } from "chai";
import { spy, verify, anything, capture, resetCalls } from "ts-mockito";

import LevelUp from "levelup";
import EncodingDown from "encoding-down";
import MemDown from "memdown";

import { BlockProcessor, BlockCache, BlockchainMachine } from "../../../src/blockMonitor";
import { Component } from "../../../src/blockMonitor/component";
import { IBlockStub, ApplicationError, BlockItemStore } from "../../../src/dataEntities";
import { StateReducer } from "../../../src/blockMonitor/component";
import fnIt from "../../utils/fnIt";
import { ActionStore } from "../../../src/blockMonitor/blockchainMachine";

const blocks: IBlockStub[] = [
    {
        hash: "hash0",
        number: 0,
        parentHash: "hash"
    },
    {
        hash: "hash1",
        number: 1,
        parentHash: "hash0"
    },
    {
        hash: "hash2",
        number: 2,
        parentHash: "hash1"
    }
];

interface ExampleState {
    someNumber: number;
}

const initialState = {
    someNumber: 42
};

class ExampleReducer implements StateReducer<ExampleState, IBlockStub> {
    getInitialState(block: IBlockStub) {
        return initialState;
    }
    reduce(prevState: ExampleState, block: IBlockStub) {
        return {
            someNumber: prevState.someNumber + block.number
        };
    }
}

type TestAction = {
    prevState: ExampleState;
    newState: ExampleState;
};

let componentsCounter = 0;
class ExampleComponent extends Component<ExampleState, IBlockStub, TestAction> {
    // make sure each component has a different name
    public readonly name = "example" + (++componentsCounter); //prettier-ignore
    public async applyAction(actions: TestAction) {}
    public detectChanges(prevState: ExampleState, state: ExampleState): TestAction[] {
        return [{ prevState: prevState, newState: state }];
    }
}

interface CanEmitAsNewHead {
    emitAsNewHead(head: IBlockStub): Promise<void>;
}

class MockBlockProcessor {
    private newHeadListeners: ((head: Readonly<IBlockStub>) => Promise<void>)[] = [];

    public addNewHeadListener(listener: (head: Readonly<IBlockStub>) => Promise<void>) {
        this.newHeadListeners.push(listener);
    }
    public removeNewHeadListener(listener: (head: Readonly<IBlockStub>) => Promise<void>) {
        const idx = this.newHeadListeners.findIndex(l => l === listener);
        if (idx === -1) throw new ApplicationError("No such listener exists.");

        this.newHeadListeners.splice(idx, 1);
    }

    // Fake the emission of a block (calling all the new_head listeners)
    public async emitAsNewHead(head: IBlockStub) {
        return Promise.all(this.newHeadListeners.map(listener => listener(head)));
    }
}

describe("ActionStore", () => {
    let actionStore: ActionStore;
    let db: any;

    const componentName = "awesome-component";
    const testActions = [
        {
            name: "action1"
        },
        {
            name: "action2"
        }
    ];

    beforeEach(async () => {
        db = LevelUp(EncodingDown<string, any>(MemDown(), { valueEncoding: "json" }));
        actionStore = new ActionStore(db);
        await actionStore.start();
    });

    it("can store an retrieve some actions", async () => {
        await actionStore.storeActions(componentName, testActions);

        const retrievedActions = [...actionStore.getActions(componentName)].map(a => a.action);
        expect(retrievedActions).to.deep.equal(testActions);
    });

    fnIt<ActionStore>(a => a.removeAction, "removes an action", async () => {
        await actionStore.storeActions(componentName, testActions);

        const retrievedActionsAndId = [...actionStore.getActions(componentName)];

        await actionStore.removeAction(componentName, retrievedActionsAndId[0]); // delete the first action

        const retrievedActionsAfter = [...actionStore.getActions(componentName)].map(a => a.action);
        expect(retrievedActionsAfter).to.deep.equal([testActions[1]]); // should only contain the second action
    });

    it("reloads actions from the db on startup", async () => {
        await actionStore.storeActions(componentName, testActions);
        await actionStore.stop();

        const newActionStore = new ActionStore(db); // a new ActionStore on the same db
        await newActionStore.start();

        const retrievedActions = [...newActionStore.getActions(componentName)]
            .map(a => a.action) // prettier-ignore
            .sort((a, b) => ((a as any).name < (b as any).name ? -1 : 1)); // make sure they are checked in the same order

        await newActionStore.stop();

        expect(retrievedActions).to.deep.equal(testActions);
    });

    fnIt<ActionStore>(a => a.removeAction, "removes an action also removes a function from the db", async () => {
        // make sure that deleted functions are also deleted from the db, and not just locally

        await actionStore.storeActions(componentName, testActions);
        const retrievedActionsAndId = [...actionStore.getActions(componentName)];

        await actionStore.removeAction(componentName, retrievedActionsAndId[0]); // delete the first action

        await actionStore.stop();

        const newActionStore = new ActionStore(db); // a new ActionStore on the same db
        await newActionStore.start();

        const retrievedActionsAfter = [...newActionStore.getActions(componentName)].map(a => a.action);
        await newActionStore.stop();
        expect(retrievedActionsAfter).to.deep.equal([testActions[1]]); // should only contain the second action
    });
});

describe("BlockchainMachine", () => {
    let reducer: ExampleReducer;
    let spiedReducer: ExampleReducer;
    let blockProcessor: BlockProcessor<IBlockStub> & CanEmitAsNewHead;
    let db: any;
    let blockStore: BlockItemStore<IBlockStub>;
    let blockCache: BlockCache<IBlockStub>;
    let actionStore: ActionStore;

    // Utility function to add a block to the block cache and also emit it as new head in the blockProcessor.
    const addAndEmitBlock = async (block: IBlockStub) => {
        await blockCache.addBlock(block);
        await blockProcessor.emitAsNewHead(block);
    };

    beforeEach(async () => {
        reducer = new ExampleReducer();
        spiedReducer = spy(reducer);

        db = LevelUp(EncodingDown<string, any>(MemDown(), { valueEncoding: "json" }));
        blockStore = new BlockItemStore<IBlockStub>(db);
        await blockStore.start();

        blockCache = new BlockCache<IBlockStub>(100, blockStore);

        // Since we only need to process events, we mock the BlockProcessor with an EventEmitter
        const bp: any = new MockBlockProcessor();
        bp.blockCache = blockCache;
        blockProcessor = bp as (BlockProcessor<IBlockStub> & CanEmitAsNewHead);

        actionStore = new ActionStore(db);
        await actionStore.start();
    });

    fnIt<BlockchainMachine<any>>(b => b.addComponent, "throws ApplicationError if already started", async () => {
        const bm = new BlockchainMachine(blockProcessor, actionStore, blockStore);
        await bm.start();

        expect(() => bm.addComponent(new ExampleComponent(reducer))).to.throw(ApplicationError);

        await bm.stop();
    });

    it("processNewBlock computes the initial state if the parent is not in cache", async () => {
        const bm = new BlockchainMachine(blockProcessor, actionStore, blockStore);
        bm.addComponent(new ExampleComponent(reducer));
        await bm.start();

        await blockCache.addBlock(blocks[0]);

        verify(spiedReducer.getInitialState(blocks[0])).once();
        verify(spiedReducer.reduce(anything(), anything())).never();

        await bm.stop();
    });

    it("processNewBlock computes state with reducer and its parent's initial state if the parent's state is not known", async () => {
        const bm = new BlockchainMachine(blockProcessor, actionStore, blockStore);
        bm.addComponent(new ExampleComponent(reducer));
        // start only after adding the first block

        await blockCache.addBlock(blocks[0]);

        await bm.start();

        resetCalls(spiedReducer);

        await blockCache.addBlock(blocks[1]);

        // initializer and reducer should both be called once
        verify(spiedReducer.getInitialState(blocks[0])).once(); // initial state from the parent block
        verify(spiedReducer.reduce(anything(), anything())).once();

        // Check that the reducer was called on the right data
        const [state, block] = capture(spiedReducer.reduce).last();
        expect(state).to.deep.equal(initialState);
        expect(block).to.deep.equal(blocks[1]);

        await bm.stop();
    });

    it("processNewBlock computes the state with the reducer if the parent's state is known", async () => {
        const bm = new BlockchainMachine(blockProcessor, actionStore, blockStore);
        bm.addComponent(new ExampleComponent(reducer));

        // this time we start the BlockchainMachine immediately
        await bm.start();

        await blockCache.addBlock(blocks[0]);
        await blockCache.addBlock(blocks[1]);

        resetCalls(spiedReducer);

        await blockCache.addBlock(blocks[2]);

        verify(spiedReducer.getInitialState(anything())).never();
        verify(spiedReducer.reduce(anything(), anything())).once();

        // Check that the reducer was called on the right data
        const [state, block] = capture(spiedReducer.reduce).last();
        expect(state).to.deep.equal({
            someNumber: 42 + blocks[1].number
        });
        expect(block).to.deep.equal(blocks[2]);

        await bm.stop();
    });

    it("processNewBlock computes the state for each component", async () => {
        const bm = new BlockchainMachine(blockProcessor, actionStore, blockStore);

        const reducers: ExampleReducer[] = [];
        const spiedReducers: ExampleReducer[] = [];
        const nComponents = 3;
        for (let i = 0; i < nComponents; i++) {
            const newReducer = new ExampleReducer();
            reducers.push(newReducer);
            spiedReducers.push(spy(newReducer));
            const component = new ExampleComponent(newReducer);
            bm.addComponent(component);
        }

        await bm.start();

        await addAndEmitBlock(blocks[0]);
        await addAndEmitBlock(blocks[1]);

        spiedReducers.forEach(r => resetCalls(r));

        // State of the parent is { someNumber: 42 + blocks[1].number }

        await addAndEmitBlock(blocks[2]);

        for (let i = 0; i < nComponents; i++) {
            // Check that each reducer was used, but not getInitialState
            verify(spiedReducers[i].getInitialState(anything())).never();
            verify(spiedReducers[i].reduce(anything(), anything())).once();
        }

        await bm.stop();
    });

    it("processNewHead does not call applyAction before NEW_HEAD_EVENT happens twice", async () => {
        const bm = new BlockchainMachine(blockProcessor, actionStore, blockStore);
        const component = new ExampleComponent(reducer);
        const spiedComponent = spy(component);

        bm.addComponent(component);
        await bm.start();

        await addAndEmitBlock(blocks[0]);

        // some new blocks added to the cache without a new_head event
        await blockCache.addBlock(blocks[1]);
        await blockCache.addBlock(blocks[2]);

        // applyAction should not have been called on the component
        verify(spiedComponent.detectChanges(anything(), anything())).never();
        verify(spiedComponent.applyAction(anything())).never();

        await bm.stop();
    });

    it("processNewHead does call applyAction", async () => {
        const bm = new BlockchainMachine(blockProcessor, actionStore, blockStore);
        const component = new ExampleComponent(reducer);
        const spiedComponent = spy(component);

        bm.addComponent(component);
        await bm.start();

        await addAndEmitBlock(blocks[0]);
        await blockCache.addBlock(blocks[1]);
        await addAndEmitBlock(blocks[2]);

        verify(spiedComponent.detectChanges(anything(), anything())).once();
        verify(spiedComponent.applyAction(anything())).once();

        // Check that applyAction was called on the right data
        const [prevState, nextState] = capture(spiedComponent.detectChanges).last();
        const [actions] = capture(spiedComponent.applyAction).last();

        const nextStateExpected = { someNumber: initialState.someNumber + blocks[1].number + blocks[2].number };
        expect(prevState, "prevState is correct").to.deep.equal(initialState);
        expect(nextState, "nextState is correct").to.deep.equal(nextStateExpected);
        expect(actions).to.deep.include({ prevState: initialState, newState: nextStateExpected });

        await bm.stop();
    });

    it("processNewHead does call applyAction on multiple components", async () => {
        const bm = new BlockchainMachine(blockProcessor, actionStore, blockStore);
        const components: ExampleComponent[] = [];
        const spiedComponents: ExampleComponent[] = [];
        const nComponents = 3;
        for (let i = 0; i < nComponents; i++) {
            const component = new ExampleComponent(reducer);
            components.push(component);
            spiedComponents.push(spy(component));
            bm.addComponent(component);
        }

        await bm.start();

        await addAndEmitBlock(blocks[0]);
        await blockCache.addBlock(blocks[1]);
        await addAndEmitBlock(blocks[2]);

        for (let i = 0; i < nComponents; i++) {
            verify(spiedComponents[i].detectChanges(anything(), anything())).once();
            verify(spiedComponents[i].applyAction(anything())).once();
        }

        await bm.stop();
    });
});
