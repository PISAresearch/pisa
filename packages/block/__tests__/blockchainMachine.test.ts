import "mocha";
import { expect } from "chai";
import { spy, verify, anything, capture, resetCalls } from "ts-mockito";

import LevelUp from "levelup";
import EncodingDown from "encoding-down";
import MemDown from "memdown";

import { BlockEvent, StateReducer, Component, BlockProcessor, BlockCache, BlockchainMachine, ActionStore, IBlockStub, BlockItemStore } from "../src";
import { ApplicationError } from "@pisa-research/errors";
import { fnIt } from "@pisa-research/test-utils";

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

describe("BlockchainMachine", () => {
    let reducer: ExampleReducer;
    let spiedReducer: ExampleReducer;
    let blockProcessor: BlockProcessor<IBlockStub>;
    let db: any;
    let blockStore: BlockItemStore<IBlockStub>;
    let blockCache: BlockCache<IBlockStub>;
    let actionStore: ActionStore;

    // Utility function to add a block to the block cache and also emit it as new head in the blockProcessor.
    const addAndEmitBlock = async (block: IBlockStub) => {
        await blockCache.addBlock(block);
        await blockProcessor.newHead.emit(block);
    };

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

        actionStore = new ActionStore(db);
        await actionStore.start();
    });

    afterEach(async () => {
        if (actionStore.started) await actionStore.stop();
        if (blockStore.started) await blockStore.stop();
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

        await blockStore.withBatch(async () => await blockCache.addBlock(blocks[0]));

        verify(spiedReducer.getInitialState(blocks[0])).once();
        verify(spiedReducer.reduce(anything(), anything())).never();

        await bm.stop();
    });

    it("processNewBlock computes state with reducer and its parent's initial state if the parent's state is not known", async () => {
        const bm = new BlockchainMachine(blockProcessor, actionStore, blockStore);
        bm.addComponent(new ExampleComponent(reducer));
        // start only after adding the first block

        await blockStore.withBatch(async () => await blockCache.addBlock(blocks[0]));

        await bm.start();

        resetCalls(spiedReducer);

        await blockStore.withBatch(async () => await blockCache.addBlock(blocks[1]));

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

        await blockStore.withBatch(async () => {
            await blockCache.addBlock(blocks[0]);
            await blockCache.addBlock(blocks[1]);
        });

        resetCalls(spiedReducer);

        await blockStore.withBatch(async () => await blockCache.addBlock(blocks[2]));

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

        await blockStore.withBatch(async () => {
            await addAndEmitBlock(blocks[0]);
            await addAndEmitBlock(blocks[1]);
        });

        spiedReducers.forEach(r => resetCalls(r));

        // State of the parent is { someNumber: 42 + blocks[1].number }

        await blockStore.withBatch(async () => await addAndEmitBlock(blocks[2]));

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

        await blockStore.withBatch(async () => await addAndEmitBlock(blocks[0]));

        // some new blocks added to the cache without a new_head event
        await blockStore.withBatch(async () => {
            await blockCache.addBlock(blocks[1]);
            await blockCache.addBlock(blocks[2]);
        });

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

        await blockStore.withBatch(async () => {
            await addAndEmitBlock(blocks[0]);
            await blockCache.addBlock(blocks[1]);
            await addAndEmitBlock(blocks[2]);
        });

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

    it("processNewHead does not call applyAction multiple times on the same action if it takes a long time", async () => {
        // In this test, we make sure that an action emitted while processing a new head is still not completed when
        // processing the next head. The BlockchainMachine should not run the first action again in this case.

        const bm = new BlockchainMachine(blockProcessor, actionStore, blockStore);
        const component = new ExampleComponentWithSlowAction(reducer);
        const spiedComponent = spy(component);

        bm.addComponent(component);
        await bm.start();

        await blockStore.withBatch(async () => {
            await addAndEmitBlock(blocks[0]);
            await blockCache.addBlock(blocks[1]);
            await addAndEmitBlock(blocks[2]);
        });
        // action is still running

        await blockStore.withBatch(async () => await addAndEmitBlock(blocks[3]));

        // now resolve all actions
        component.resolveActions();

        await Promise.resolve();

        const midState = { someNumber: initialState.someNumber + blocks[1].number + blocks[2].number };
        const finalState = { someNumber: initialState.someNumber + blocks[1].number + blocks[2].number + blocks[3].number };

        const firstAction = { prevState: initialState, newState: midState };
        const secondAction = { prevState: midState, newState: finalState };

        verify(spiedComponent.detectChanges(anything(), anything())).twice();
        verify(spiedComponent.applyAction(anything())).twice();

        // Check that applyAction was called on the right data
        const [action1] = capture(spiedComponent.applyAction).first();
        const [action2] = capture(spiedComponent.applyAction).last();
        expect(action1).to.deep.equal(firstAction);
        expect(action2).to.deep.equal(secondAction);

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

        await blockStore.withBatch(async () => {
            await addAndEmitBlock(blocks[0]);
            await blockCache.addBlock(blocks[1]);
            await addAndEmitBlock(blocks[2]);
        });

        for (let i = 0; i < nComponents; i++) {
            verify(spiedComponents[i].detectChanges(anything(), anything())).once();
            verify(spiedComponents[i].applyAction(anything())).once();
        }

        await bm.stop();
    });
});
