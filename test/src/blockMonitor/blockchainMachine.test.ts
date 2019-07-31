import "mocha";
import { expect } from "chai";
import { spy, verify, anything, capture, resetCalls } from "ts-mockito";
import { BlockProcessor, BlockCache, BlockchainMachine } from "../../../src/blockMonitor";
import { Component } from "../../../src/blockMonitor/component";
import { IBlockStub, ApplicationError } from "../../../src/dataEntities";
import { StateReducer } from "../../../src/blockMonitor/component";
import { EventEmitter } from "events";
import fnIt from "../../utils/fnIt";

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

class ExampleComponent extends Component<ExampleState, IBlockStub> {
    public handleChanges(prevState: ExampleState, state: ExampleState): void {}
}

describe("BlockchainMachine", () => {
    let reducer: ExampleReducer;
    let spiedReducer: ExampleReducer;
    let blockProcessor: BlockProcessor<IBlockStub>;
    let blockCache: BlockCache<IBlockStub>;

    beforeEach(() => {
        reducer = new ExampleReducer();
        spiedReducer = spy(reducer);

        blockCache = new BlockCache<IBlockStub>(100);
        blocks.forEach(b => blockCache.addBlock(b));

        // Since we only need to process events, we mock the BlockProcessor with an EventEmitter
        const bp: any = new EventEmitter();
        bp.blockCache = blockCache;
        blockProcessor = bp as BlockProcessor<IBlockStub>;
    });

    fnIt<BlockchainMachine<any>>(b => b.addComponent, "throws ApplicationError if already started", async () => {
        const bm = new BlockchainMachine(blockProcessor);
        await bm.start();

        expect(() => bm.addComponent(new ExampleComponent(reducer))).to.throw(ApplicationError);

        await bm.stop();
    });

    it(" processNewBlock computes the initial state if the parent is not in cache", async () => {
        const bm = new BlockchainMachine(blockProcessor);
        bm.addComponent(new ExampleComponent(reducer));
        await bm.start();

        blockProcessor.emit(BlockProcessor.NEW_BLOCK_EVENT, blocks[0]);

        verify(spiedReducer.getInitialState(blocks[0])).once();
        verify(spiedReducer.reduce(anything(), anything())).never();

        await bm.stop();
    });

    it("processNewBlock computes state with reducer and its parent's initial state if the parent's state is not known", async () => {
        const bm = new BlockchainMachine(blockProcessor);
        bm.addComponent(new ExampleComponent(reducer));
        await bm.start();

        blockProcessor.emit(BlockProcessor.NEW_BLOCK_EVENT, blocks[1]);

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
        const bm = new BlockchainMachine(blockProcessor);
        bm.addComponent(new ExampleComponent(reducer));
        await bm.start();

        blockProcessor.emit(BlockProcessor.NEW_BLOCK_EVENT, blocks[0]);
        blockProcessor.emit(BlockProcessor.NEW_BLOCK_EVENT, blocks[1]);

        resetCalls(spiedReducer);

        // State of the parent is { someNumber: 42 + blocks[1].number }

        blockProcessor.emit(BlockProcessor.NEW_BLOCK_EVENT, blocks[2]);

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
        const bm = new BlockchainMachine(blockProcessor);

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

        blockProcessor.emit(BlockProcessor.NEW_BLOCK_EVENT, blocks[0]);
        blockProcessor.emit(BlockProcessor.NEW_BLOCK_EVENT, blocks[1]);

        spiedReducers.forEach(r => resetCalls(r));

        // State of the parent is { someNumber: 42 + blocks[1].number }

        blockProcessor.emit(BlockProcessor.NEW_BLOCK_EVENT, blocks[2]);

        for (let i = 0; i < nComponents; i++) {
            // Check that each reducer was used, but not getInitialState
            verify(spiedReducers[i].getInitialState(anything())).never();
            verify(spiedReducers[i].reduce(anything(), anything())).once();
        }

        await bm.stop();
    });

    it("processNewHead does not call handleChanges before NEW_HEAD_EVENT happens twice", async () => {
        const bm = new BlockchainMachine(blockProcessor);
        const component = new ExampleComponent(reducer);
        const spiedComponent = spy(component);

        bm.addComponent(component);
        await bm.start();

        blockProcessor.emit(BlockProcessor.NEW_BLOCK_EVENT, blocks[0]);
        blockProcessor.emit(BlockProcessor.NEW_HEAD_EVENT, blocks[0], null);

        // some new blocks without a new_head event
        blockProcessor.emit(BlockProcessor.NEW_BLOCK_EVENT, blocks[1]);
        blockProcessor.emit(BlockProcessor.NEW_BLOCK_EVENT, blocks[2]);

        // handleChanges should not have been called on the component
        verify(spiedComponent.handleChanges(anything(), anything())).never();

        await bm.stop();
    });

    it("processNewHead does call handleChanges", async () => {
        const bm = new BlockchainMachine(blockProcessor);
        const component = new ExampleComponent(reducer);
        const spiedComponent = spy(component);

        bm.addComponent(component);
        await bm.start();

        blockProcessor.emit(BlockProcessor.NEW_BLOCK_EVENT, blocks[0]);
        blockProcessor.emit(BlockProcessor.NEW_HEAD_EVENT, blocks[0], null);

        blockProcessor.emit(BlockProcessor.NEW_BLOCK_EVENT, blocks[1]);
        blockProcessor.emit(BlockProcessor.NEW_BLOCK_EVENT, blocks[2]);
        blockProcessor.emit(BlockProcessor.NEW_HEAD_EVENT, blocks[2], blocks[0]);

        verify(spiedComponent.handleChanges(anything(), anything())).once();

        // Check that handleChanges was called on the right data
        const [prevState, newState] = capture(spiedComponent.handleChanges).last();

        expect(prevState).to.deep.equal(initialState);
        expect(newState).to.deep.equal({
            someNumber: initialState.someNumber + blocks[1].number + blocks[2].number
        });

        await bm.stop();
    });

    it("processNewHead throws ApplicationError if the state was not computed for the current head", async () => {
        const bm = new BlockchainMachine(blockProcessor);
        const component = new ExampleComponent(reducer);

        bm.addComponent(component);
        await bm.start();

        blockProcessor.emit(BlockProcessor.NEW_BLOCK_EVENT, blocks[0]);
        blockProcessor.emit(BlockProcessor.NEW_HEAD_EVENT, blocks[0], null);

        // We simulate a new_head without a new_block event (which is never expected to happen)
        expect(() => blockProcessor.emit(BlockProcessor.NEW_HEAD_EVENT, blocks[1], blocks[0])).to.throw(ApplicationError); //prettier-ignore

        await bm.stop();
    });

    it("processNewHead does call handleChanges on multiple components", async () => {
        const bm = new BlockchainMachine(blockProcessor);
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

        blockProcessor.emit(BlockProcessor.NEW_BLOCK_EVENT, blocks[0]);
        blockProcessor.emit(BlockProcessor.NEW_HEAD_EVENT, blocks[0], null);

        blockProcessor.emit(BlockProcessor.NEW_BLOCK_EVENT, blocks[1]);
        blockProcessor.emit(BlockProcessor.NEW_BLOCK_EVENT, blocks[2]);
        blockProcessor.emit(BlockProcessor.NEW_HEAD_EVENT, blocks[2], blocks[0]);

        for (let i = 0; i < nComponents; i++) {
            verify(spiedComponents[i].handleChanges(anything(), anything())).once();
        }

        await bm.stop();
    });
});
