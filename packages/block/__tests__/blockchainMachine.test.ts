import "mocha";
import chai, { expect } from "chai";
import { spy, verify, anything, resetCalls, mock, when, deepEqual as DE, instance } from "ts-mockito";

import LevelUp from "levelup";
import EncodingDown from "encoding-down";
import MemDown from "memdown";

import {
    StateReducer,
    Component,
    CachedKeyValueStore,
    IBlockStub,
    BlockItemStore,
    ComponentAction
} from "../src";

import { BlockchainMachine } from "../src/blockchainMachine";
import { throwingInstance, fnIt, wait } from "@pisa-research/test-utils";
import { ArgumentError, ConfigurationError } from "@pisa-research/errors";
import chaiAsPromised from "chai-as-promised";
import { PlainObject, DbObject, defaultSerialiser } from "@pisa-research/utils";
chai.use(chaiAsPromised);

type TestAnchorState = { number: number; extraData: string } & PlainObject;
const anchorStates: TestAnchorState[] = [];

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
    const db = LevelUp(EncodingDown<string, DbObject>(MemDown(), { valueEncoding: "json" }));

    const blockItemStore: BlockItemStore<IBlockStub> = new BlockItemStore(db, defaultSerialiser);
    const blockItemStoreSpy = spy(blockItemStore);
    const blockItemStoreAnchorStateSpy = spy(blockItemStore.anchorState);

    const reducerMock: StateReducer<TestAnchorState, IBlockStub> = mock<StateReducer<TestAnchorState, IBlockStub>>();
    when(reducerMock.getInitialState(DE(blocks[0]))).thenResolve(getAnchorState(0));
    when(reducerMock.reduce(DE(getAnchorState(0)), DE(blocks[1]))).thenResolve(getAnchorState(1));
    const reducer = instance(reducerMock);

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
        when(componentMock.detectChanges(DE(getAnchorState(0)), DE(getAnchorState(1)))).thenReturn(detectChangesResult);
        if (applyActionThrowsError) {
            when(componentMock.applyAction(DE(getAction(0)))).thenReject(new Error("FailedAction0"));
            when(componentMock.applyAction(DE(getAction(1)))).thenReject(new Error("FailedAction1"));
        } else {
            when(componentMock.applyAction(DE(getAction(0)))).thenResolve();
            when(componentMock.applyAction(DE(getAction(1)))).thenResolve();
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

    fnIt<BlockchainMachine<never>>(b => b.setInitialState, "does compute initial state for parent not in store", async () => {
        const { machine, reducerMock, blockItemStoreAnchorStateSpy, components, reducer } = await setupBM(1);

        await machine.blockItemStore.withBatch(async () => {
            await machine.setInitialState(blocks[0]);
        });

        verify(reducerMock.getInitialState(DE(blocks[0]))).once();
        verify(blockItemStoreAnchorStateSpy.set(components[0].name, blocks[0].number, blocks[0].hash, DE(await reducer.getInitialState(blocks[0])))).once();
    });

    fnIt<BlockchainMachine<never>>(b => b.setInitialState, "does compute initial state for parent in store", async () => {
        const { machine, reducerMock, blockItemStoreAnchorStateSpy, components, reducer } = await setupInitialisedBM(1);

        await machine.blockItemStore.withBatch(async () => {
            await machine.setInitialState(blocks[1]);
        });

        verify(reducerMock.reduce(DE(getAnchorState(0)), DE(blocks[1]))).once();
        verify(blockItemStoreAnchorStateSpy.set(components[0].name, blocks[1].number, blocks[1].hash, DE(await reducer.reduce(getAnchorState(0), blocks[1])))).once();
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
        verify(blockItemStoreAnchorStateSpy.set(components[0].name, blocks[0].number, blocks[0].hash, DE(await reducer.getInitialState(blocks[0])))).once();
        verify(blockItemStoreAnchorStateSpy.set(components[1].name, blocks[0].number, blocks[0].hash, DE(await reducer.getInitialState(blocks[0])))).once();
    });

    fnIt<BlockchainMachine<never>>(b => b.setStateAndDetectChanges, "does set new state and run actions", async () => {
        const { actionStoreSpy, machine, reducerMock, blockItemStoreAnchorStateSpy, components, componentMocks, reducer } = await setupInitialisedBM(1);

        await machine.blockItemStore.withBatch(async () => {
            await machine.setStateAndDetectChanges(blocks[1]);
        });

        verify(reducerMock.reduce(DE(getAnchorState(0)), DE(blocks[1]))).once();
        verify(blockItemStoreAnchorStateSpy.set(components[0].name, blocks[1].number, blocks[1].hash, DE(await reducer.reduce(getAnchorState(0), blocks[1])))).once();
        verify(componentMocks[0].detectChanges(DE(getAnchorState(0)), DE(getAnchorState(1)))).once();
        verify(actionStoreSpy.storeItems(components[0].name, anything())).once();
        verify(componentMocks[0].applyAction(DE(getAction(0)))).once();
        verify(componentMocks[0].applyAction(DE(getAction(1)))).once();
        verify(actionStoreSpy.removeItem(components[0].name, anything())).twice();
        verify(actionStoreSpy.storeItems(components[0].name, anything())).calledBefore(componentMocks[0].applyAction(anything()));
        verify(componentMocks[0].applyAction(anything())).calledBefore(actionStoreSpy.removeItem(components[0].name, anything()));
    });

    fnIt<BlockchainMachine<never>>(b => b.setStateAndDetectChanges, "does not throw error or remove action if apply action throws error", async () => {
        const { actionStoreSpy, machine, reducerMock, blockItemStoreAnchorStateSpy, components, componentMocks, reducer } = await setupInitialisedBM(1, true);

        await machine.blockItemStore.withBatch(async () => {
            await machine.setStateAndDetectChanges(blocks[1]);
        });

        verify(reducerMock.reduce(DE(getAnchorState(0)), DE(blocks[1]))).once();
        verify(blockItemStoreAnchorStateSpy.set(components[0].name, blocks[1].number, blocks[1].hash, DE(await reducer.reduce(getAnchorState(0), blocks[1])))).once();
        verify(componentMocks[0].detectChanges(DE(getAnchorState(0)), DE(getAnchorState(1)))).once();
        verify(actionStoreSpy.storeItems(components[0].name, anything())).once();
        verify(componentMocks[0].applyAction(DE(getAction(0)))).once();
        verify(componentMocks[0].applyAction(DE(getAction(1)))).once();
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
});