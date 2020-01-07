import "mocha";
import chai, { expect } from "chai";
import { spy, verify, anything, capture, resetCalls, mock, instance, when } from "ts-mockito";

import LevelUp from "levelup";
import EncodingDown from "encoding-down";
import MemDown from "memdown";

import {
    BlockEvent,
    StateReducer,
    Component,
    BlockProcessor,
    BlockCache,
    BlockchainMachine as BlockchainMachineService,
    CachedKeyValueStore,
    IBlockStub,
    BlockItemStore,
    ComponentAction
} from "../src";

import { BlockchainMachine } from "../src/blockchainMachine";
import { throwingInstance, fnIt, wait } from "@pisa-research/test-utils";
import { ArgumentError, ConfigurationError } from "@pisa-research/errors";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);

type TestAnchorState = { number: number; extraData: string };
const anchorStates: TestAnchorState[] = [];

const getAnchorState = (index: number) => {
    if (anchorStates[index]) return anchorStates[index];
    else {
        const newState = { number: blocks[index].number, extraData: "extra" + index };
        anchorStates[index] = newState;
        return newState;
    }
};

const actions: TestActionType[] = [];
type TestActionType = { actionNumber: number };

const getAction = (index: number) => {
    if (actions[index]) return actions[index];
    else {
        const newAction = { actionNumber: index };
        actions[index] = newAction;
        return newAction;
    }
};

// the mocking lib we use isnt able to mock abstract members and functions
// so we create a dummy subclass
class TestComponent extends Component<TestAnchorState, IBlockStub, TestActionType> {
    detectChanges(prevState: TestAnchorState, nextState: TestAnchorState): TestActionType[] {
        throw new Error("not implemented");
    }
    async applyAction(action: TestActionType) {}
    name: string;
}

const setupBM = async (
    componentNumber: number,
    applyActionThrowsError: boolean = false,
    actionStore: CachedKeyValueStore<ComponentAction> | undefined = undefined
) => {
    const db = LevelUp(EncodingDown<string, any>(MemDown(), { valueEncoding: "json" }));

    const blockItemStore: BlockItemStore<IBlockStub> = new BlockItemStore(db);
    const blockItemStoreSpy = spy(blockItemStore);
    const blockItemStoreAnchorStateSpy = spy(blockItemStore.anchorState);

    const reducerMock: StateReducer<TestAnchorState, IBlockStub> = mock<StateReducer<TestAnchorState, IBlockStub>>();
    when(reducerMock.getInitialState(blocks[0])).thenReturn(getAnchorState(0));
    when(reducerMock.reduce(getAnchorState(0), blocks[1])).thenReturn(getAnchorState(1));
    const reducer = throwingInstance(reducerMock);

    if (!actionStore) {
        actionStore = new CachedKeyValueStore<ComponentAction>(db, "test-actions");
        await actionStore.start();
    }
    const actionStoreSpy = spy(actionStore);

    const components: TestComponent[] = [];
    const componentMocks: TestComponent[] = [];
    for (let index = 0; index < componentNumber; index++) {
        const componentMock: TestComponent = mock(TestComponent);
        const name = "name-" + index;
        when(componentMock.name).thenReturn(name);
        when(componentMock.reducer).thenReturn(reducer);
        const detectChangesResult = [getAction(0), getAction(1)];
        when(componentMock.detectChanges(getAnchorState(0), getAnchorState(1))).thenReturn(detectChangesResult);
        if (applyActionThrowsError) {
            when(componentMock.applyAction(getAction(0))).thenReject(new Error("FailedAction0"));
            when(componentMock.applyAction(getAction(1))).thenReject(new Error("FailedAction1"));
        } else {
            when(componentMock.applyAction(getAction(0))).thenResolve();
            when(componentMock.applyAction(getAction(1))).thenResolve();
        }

        components.push(throwingInstance(componentMock));
        componentMocks.push(componentMock);
    }

    const machine: BlockchainMachine<IBlockStub> = new BlockchainMachine(actionStore, blockItemStore, components);

    return {
        machine,
        actionStore,
        actionStoreSpy,
        blockItemStore,
        blockItemStoreSpy,
        blockItemStoreAnchorStateSpy,
        components,
        componentMocks,
        reducer,
        reducerMock,
        db
    };
};

const setupInitialisedBM = async (componentNumber: number, applyActionThrowsError: boolean = false) => {
    const setup = await setupBM(componentNumber, applyActionThrowsError);

    await setup.machine.blockItemStore.withBatch(async () => {
        await setup.machine.setInitialState(blocks[0]);
    });

    resetCalls(setup.reducerMock);
    resetCalls(setup.blockItemStoreAnchorStateSpy);

    return setup;
};

describe("BlockchainMachine", () => {
    it("constructor does not accept duplicate component names", async () => {
        const { actionStoreSpy, blockItemStore, componentMocks } = await setupBM(1);

        expect(
            () =>
                new BlockchainMachine(throwingInstance(actionStoreSpy), blockItemStore, [
                    throwingInstance(componentMocks[0]),
                    throwingInstance(componentMocks[0])
                ])
        ).to.throw(ArgumentError);
    });

    it("setInitialState does enforce that action store has started");
    it("setState does enforce that action store has started");

    fnIt<BlockchainMachine<never>>(b => b.setInitialState, "does compute initial state for parent not in store", async () => {
        const { machine, reducerMock, blockItemStoreAnchorStateSpy, components, reducer } = await setupBM(1);

        await machine.blockItemStore.withBatch(async () => {
            await machine.setInitialState(blocks[0]);
        });

        verify(reducerMock.getInitialState(blocks[0])).once();
        verify(blockItemStoreAnchorStateSpy.set(components[0].name, blocks[0].number, blocks[0].hash, reducer.getInitialState(blocks[0]))).once();
    });

    fnIt<BlockchainMachine<never>>(b => b.setInitialState, "does compute initial state for parent in store", async () => {
        const { machine, reducerMock, blockItemStoreAnchorStateSpy, components, reducer } = await setupInitialisedBM(1);

        await machine.blockItemStore.withBatch(async () => {
            await machine.setInitialState(blocks[1]);
        });

        verify(reducerMock.reduce(getAnchorState(0), blocks[1])).once();
        verify(blockItemStoreAnchorStateSpy.set(components[0].name, blocks[1].number, blocks[1].hash, reducer.reduce(getAnchorState(0), blocks[1]))).once();
    });

    fnIt<BlockchainMachine<never>>(b => b.setInitialState, "does nothing if state is already in store", async () => {
        const { machine, reducerMock, blockItemStoreAnchorStateSpy } = await setupInitialisedBM(1);

        await machine.blockItemStore.withBatch(async () => {
            await machine.setInitialState(blocks[0]);
        });

        verify(reducerMock.reduce(anything(), anything())).never();
        verify(blockItemStoreAnchorStateSpy.set(anything(), anything(), anything(), anything())).never();
    });

    fnIt<BlockchainMachine<never>>(b => b.setInitialState, "does compute initial state for multiple components", async () => {
        const { machine, reducerMock, blockItemStoreAnchorStateSpy, components, reducer } = await setupBM(2);

        await machine.blockItemStore.withBatch(async () => {
            await machine.setInitialState(blocks[0]);
        });

        verify(reducerMock.getInitialState(blocks[0])).twice();
        verify(blockItemStoreAnchorStateSpy.set(components[0].name, blocks[0].number, blocks[0].hash, reducer.getInitialState(blocks[0]))).once();
        verify(blockItemStoreAnchorStateSpy.set(components[1].name, blocks[0].number, blocks[0].hash, reducer.getInitialState(blocks[0]))).once();
    });

    fnIt<BlockchainMachine<never>>(b => b.setStateAndDetectChanges, "does set new state and run actions", async () => {
        const { actionStoreSpy, machine, reducerMock, blockItemStoreAnchorStateSpy, components, componentMocks, reducer } = await setupInitialisedBM(1);

        await machine.blockItemStore.withBatch(async () => {
            await machine.setStateAndDetectChanges(blocks[1]);
        });

        verify(reducerMock.reduce(getAnchorState(0), blocks[1])).once();
        verify(blockItemStoreAnchorStateSpy.set(components[0].name, blocks[1].number, blocks[1].hash, reducer.reduce(getAnchorState(0), blocks[1]))).once();
        verify(componentMocks[0].detectChanges(getAnchorState(0), getAnchorState(1))).once();
        verify(actionStoreSpy.storeItems(components[0].name, anything())).once();
        verify(componentMocks[0].applyAction(getAction(0))).once();
        verify(componentMocks[0].applyAction(getAction(1))).once();
        verify(actionStoreSpy.removeItem(components[0].name, anything())).twice();
        verify(actionStoreSpy.storeItems(components[0].name, anything())).calledBefore(componentMocks[0].applyAction(anything()));
        verify(componentMocks[0].applyAction(anything())).calledBefore(actionStoreSpy.removeItem(components[0].name, anything()));
    });

    fnIt<BlockchainMachine<never>>(b => b.setStateAndDetectChanges, "does not throw error or remove action if apply action throws error", async () => {
        const { actionStoreSpy, machine, reducerMock, blockItemStoreAnchorStateSpy, components, componentMocks, reducer } = await setupInitialisedBM(1, true);

        await machine.blockItemStore.withBatch(async () => {
            await machine.setStateAndDetectChanges(blocks[1]);
        });

        verify(reducerMock.reduce(getAnchorState(0), blocks[1])).once();
        verify(blockItemStoreAnchorStateSpy.set(components[0].name, blocks[1].number, blocks[1].hash, reducer.reduce(getAnchorState(0), blocks[1]))).once();
        verify(componentMocks[0].detectChanges(getAnchorState(0), getAnchorState(1))).once();
        verify(actionStoreSpy.storeItems(components[0].name, anything())).once();
        verify(componentMocks[0].applyAction(getAction(0))).once();
        verify(componentMocks[0].applyAction(getAction(1))).once();
        verify(actionStoreSpy.removeItem(components[0].name, anything())).never();
        verify(actionStoreSpy.storeItems(components[0].name, anything())).calledBefore(componentMocks[0].applyAction(anything()));
    });

    fnIt<BlockchainMachine<never>>(b => b.setStateAndDetectChanges, "does throw error for non existing parent", async () => {
        const { machine } = await setupBM(1, true);

        // we expect the batch to throw as well
        return expect(
            machine.blockItemStore.withBatch(async () => {
                await machine.setStateAndDetectChanges(blocks[1]);
            })
        ).to.eventually.be.rejectedWith(ConfigurationError, "Parent state");
    });

    fnIt<BlockchainMachine<never>>(b => b.setStateAndDetectChanges, "runs any actions currently in the action store", async () => {
        const { machine: errorMachine, actionStore } = await setupInitialisedBM(1, true);

        // throwing an exception means that actions arent removed from the store
        try {
            await errorMachine.blockItemStore.withBatch(async () => {
                await errorMachine.setStateAndDetectChanges(blocks[1]);
            });
        } catch (doh) {
            if((doh.message as string).startsWith("FailedAction")) {
                
            } else throw doh;
        }

        const { machine, actionStoreSpy } = await setupBM(1, false, actionStore);
        machine.executeExistingActions();

        await wait(10);
        verify(actionStoreSpy.removeItem(anything(), anything())).twice();
    });

    // PISA: add commments to the state reducer
    // PISA: add integration tests just for the blockchain machine
    // PISA: what if the setinitialstate throws error? retry - add this to the log reducer
});

// describe("BlockchainMachineService", () => {
//     it("start does set initial state")
//     it("start new block does set state and detect changes")
//     it("start does execute initial actions")
// })

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
    },
    {
        hash: "hash3",
        number: 3,
        parentHash: "hash2"
    }
];

interface ExampleState {
    someNumber: number;
}

const initialState = {
    someNumber: 42
};

class ExampleReducer implements StateReducer<ExampleState, IBlockStub> {
    async getInitialState(block: IBlockStub) {
        return initialState;
    }
    async reduce(prevState: ExampleState, block: IBlockStub) {
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

class ExampleComponentWithSlowAction extends ExampleComponent {
    private resolvers = new Set<() => void>();
    public async applyAction(actions: TestAction) {
        // promise that never resolves until resolveAction is called
        await new Promise(resolve => {
            this.resolvers.add(resolve);
        });
    }
    public resolveActions() {
        // resolve any running action
        for (const resolve of this.resolvers) resolve();
        this.resolvers.clear();
    }
}

class MockBlockProcessor {
    constructor(public readonly blockCache: BlockCache<IBlockStub>) {
        blockCache.newBlock.addListener(block => this.newBlock.emit(block));
    }
    public newBlock = new BlockEvent<IBlockStub>();
    public newHead = new BlockEvent<IBlockStub>();
    public readonly started = true;
}

describe("BlockchainMachineService2", () => {
    let reducer: ExampleReducer;
    let spiedReducer: ExampleReducer;
    let blockProcessor: BlockProcessor<IBlockStub>;
    let db: any;
    let blockStore: BlockItemStore<IBlockStub>;
    let blockCache: BlockCache<IBlockStub>;
    let actionStore: CachedKeyValueStore<ComponentAction>;

    beforeEach(async () => {
        reducer = new ExampleReducer();
        spiedReducer = spy(reducer);

        db = LevelUp(EncodingDown<string, any>(MemDown(), { valueEncoding: "json" }));
        blockStore = new BlockItemStore<IBlockStub>(db);
        await blockStore.start();

        blockCache = new BlockCache<IBlockStub>(100, blockStore);

        // Since we only need to process events, we mock the BlockProcessor with an EventEmitter
        const bp: any = new MockBlockProcessor(blockCache);
        blockProcessor = bp as BlockProcessor<IBlockStub>;

        actionStore = new CachedKeyValueStore<ComponentAction>(db, "blockchain-machine");
        await actionStore.start();
    });

    afterEach(async () => {
        if (actionStore.started) await actionStore.stop();
        if (blockStore.started) await blockStore.stop();
    });

    it("processNewBlock computes the initial state if the parent is not in cache", async () => {
        const component = new ExampleComponent(reducer);
        const spiedComponent = spy(component);
        const bm = new BlockchainMachineService(blockProcessor, actionStore, blockStore, [component]);
        await blockStore.withBatch(async () => await blockCache.addBlock(blocks[0]));
        blockCache.setHead(blocks[0].hash);

        await bm.start();

        verify(spiedReducer.getInitialState(blocks[0])).once();
        verify(spiedReducer.reduce(anything(), anything())).never();
        verify(spiedComponent.applyAction(anything())).never();
        verify(spiedComponent.detectChanges(anything(), anything())).never();

        await bm.stop();
    });

    it("processNewBlock computes state with reducer and its parent's initial state if the parent's state is not known", async () => {
        const component = new ExampleComponent(reducer);
        const spiedComponent = spy(component);
        const bm = new BlockchainMachineService(blockProcessor, actionStore, blockStore, []);
        // start only after adding the first block

        await blockStore.withBatch(async () => await blockCache.addBlock(blocks[0]));
        blockCache.setHead(blocks[0].hash);

        verify(spiedComponent.applyAction(anything())).never();
        verify(spiedComponent.detectChanges(anything(), anything())).never();

        await bm.start();

        resetCalls(spiedReducer);
        resetCalls(spiedComponent);

        await blockStore.withBatch(async () => await blockCache.addBlock(blocks[1]));

        // initializer and reducer should both be called once
        verify(spiedReducer.getInitialState(blocks[0])).once(); // initial state from the parent block
        verify(spiedReducer.reduce(anything(), anything())).once();

        // detect changs and apply action should both be called once
        verify(spiedComponent.applyAction(anything())).once();
        verify(spiedComponent.detectChanges(anything(), anything())).once();

        // Check that applyAction was called on the right data
        const [prevState, nextState] = capture(spiedComponent.detectChanges).last();
        const [actions] = capture(spiedComponent.applyAction).last();

        const nextStateExpected = { someNumber: initialState.someNumber + blocks[1].number };
        expect(prevState, "prevState is correct").to.deep.equal(initialState);
        expect(nextState, "nextState is correct").to.deep.equal(nextStateExpected);
        expect(actions).to.deep.include({ prevState: initialState, newState: nextStateExpected });

        // Check that the reducer was called on the right data
        const [state, block] = capture(spiedReducer.reduce).last();
        expect(state).to.deep.equal(initialState);
        expect(block).to.deep.equal(blocks[1]);

        await bm.stop();
    });

    it("processNewBlock computes the state with the reducer if the parent's state is known", async () => {
        const component = new ExampleComponent(reducer);
        const spiedComponent = spy(component);
        const bm = new BlockchainMachineService(blockProcessor, actionStore, blockStore, [component]);

        // this time we start the BlockchainMachine immediately
        await bm.start();

        await blockStore.withBatch(async () => {
            await blockCache.addBlock(blocks[0]);
            blockCache.setHead(blocks[0].hash);
            await blockCache.addBlock(blocks[1]);
        });

        resetCalls(spiedReducer);
        resetCalls(spiedComponent);

        await blockStore.withBatch(async () => await blockCache.addBlock(blocks[2]));

        verify(spiedReducer.getInitialState(anything())).never();
        verify(spiedReducer.reduce(anything(), anything())).once();

        verify(spiedComponent.applyAction(anything())).once();
        verify(spiedComponent.detectChanges(anything(), anything())).once();

        // Check that applyAction was called on the right data
        const [prevState, nextState] = capture(spiedComponent.detectChanges).last();
        const [actions] = capture(spiedComponent.applyAction).last();

        const expectedPrevState = { someNumber: initialState.someNumber + blocks[1].number };
        const nextStateExpected = { someNumber: initialState.someNumber + blocks[1].number + blocks[2].number };
        expect(prevState, "prevState is correct").to.deep.equal(expectedPrevState);
        expect(nextState, "nextState is correct").to.deep.equal(nextStateExpected);
        expect(actions).to.deep.include({ prevState: expectedPrevState, newState: nextStateExpected });

        // Check that the reducer was called on the right data
        const [state, block] = capture(spiedReducer.reduce).last();
        expect(state).to.deep.equal({
            someNumber: 42 + blocks[1].number
        });
        expect(block).to.deep.equal(blocks[2]);

        await bm.stop();
    });

    it("processNewBlock computes the state for each component", async () => {
        const reducers: ExampleReducer[] = [];
        const spiedReducers: ExampleReducer[] = [];
        const spiedComponents: ExampleComponent[] = [];
        const nComponents = 3;
        for (let i = 0; i < nComponents; i++) {
            const newReducer = new ExampleReducer();
            reducers.push(newReducer);
            spiedReducers.push(spy(newReducer));
            const component = new ExampleComponent(newReducer);
            spiedComponents.push(spy(component));
        }

        const bm = new BlockchainMachineService(blockProcessor, actionStore, blockStore, spiedComponents);

        await blockStore.withBatch(async () => {
            await blockCache.addBlock(blocks[0]);
            blockCache.setHead(blocks[0].hash);
            await blockCache.addBlock(blocks[1]);
        });
        await bm.start();

        spiedReducers.forEach(r => resetCalls(r));

        // State of the parent is { someNumber: 42 + blocks[1].number }

        await blockStore.withBatch(async () => await blockCache.addBlock(blocks[2]));

        for (let i = 0; i < nComponents; i++) {
            // Check that each reducer was used, but not getInitialState
            verify(spiedReducers[i].getInitialState(anything())).never();
            verify(spiedReducers[i].reduce(anything(), anything())).once();

            // check that all the components were called
            verify(spiedComponents[i].applyAction(anything()));
            verify(spiedComponents[i].detectChanges(anything(), anything()));
        }

        await bm.stop();
    });

    it("processNewHead does not call applyAction multiple times on the same action if it takes a long time", async () => {
        // In this test, we make sure that an action emitted while processing a new head is still not completed when
        // processing the next head. The BlockchainMachine should not run the first action again in this case.

        const component = new ExampleComponentWithSlowAction(reducer);
        const spiedComponent = spy(component);
        const bm = new BlockchainMachineService(blockProcessor, actionStore, blockStore, [component]);

        await blockStore.withBatch(async () => {
            await blockCache.addBlock(blocks[0]);
            blockCache.setHead(blocks[0].hash);
            await blockCache.addBlock(blocks[1]);
            await blockCache.addBlock(blocks[2]);
        });
        // action is still running
        await bm.start();

        await blockStore.withBatch(async () => await blockCache.addBlock(blocks[3]));

        // now resolve all actions
        component.resolveActions();

        await Promise.resolve();

        const firstState = { someNumber: initialState.someNumber + blocks[1].number };
        const secondState = { someNumber: initialState.someNumber + blocks[1].number + blocks[2].number };
        const finalState = { someNumber: initialState.someNumber + blocks[1].number + blocks[2].number + blocks[3].number };

        const firstAction = { prevState: initialState, newState: firstState };
        const secondAction = { prevState: secondState, newState: finalState };

        verify(spiedComponent.detectChanges(anything(), anything())).thrice();
        verify(spiedComponent.applyAction(anything())).thrice();

        // Check that applyAction was called on the right data
        const [action1] = capture(spiedComponent.applyAction).first();
        const [action2] = capture(spiedComponent.applyAction).last();
        expect(action1).to.deep.equal(firstAction);
        expect(action2).to.deep.equal(secondAction);

        await bm.stop();
    });
});
