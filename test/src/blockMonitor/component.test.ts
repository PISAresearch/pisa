import "mocha";
import { expect } from "chai";
import { MappedStateReducer, StateReducer, BlockNumberReducer } from "../../../src/blockMonitor/component";
import { IBlockStub } from "../../../src/dataEntities/block";
import fnIt from "../../utils/fnIt";

const objects = [
    {
        id: "id1",
        value: 10
    },
    {
        id: "id2",
        value: 20
    },
    {
        id: "id3",
        value: 30
    }
];

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

type TestAnchorState = {
    someNumber: number;
};

class TestAnchorStateReducer implements StateReducer<TestAnchorState, IBlockStub> {
    constructor(private readonly startValue: number) {}
    getInitialState = (block: IBlockStub) => ({ someNumber: this.startValue + block.number });
    reduce = (prevState: TestAnchorState, block: IBlockStub) => ({
        someNumber: prevState.someNumber + block.number
    });
}

class NullReducer implements StateReducer<{}, IBlockStub> {
    getInitialState() {
        return {};
    }
    reduce(prevState: {}, block: IBlockStub) {
        return {};
    }
}

describe("MappedStateReducer", () => {
    let blocks: IBlockStub[] = [];

    before(() => {
        const nBlocks = 5;
        // some blocks, numbered from 1
        for (let i = 1; i <= nBlocks; i++) {
            blocks.push({
                number: i,
                hash: `hash${i}`,
                parentHash: `hash${i - 1}`
            });
        }
    });

    fnIt<MappedStateReducer<any, any, any, any>>(m => m.getInitialState, "computes initial state", () => {
        const msr = new MappedStateReducer<TestAnchorState, {}, IBlockStub, { id: string }>(
            () => [],
            () => new NullReducer(),
            o => o.id,
            new TestAnchorStateReducer(10)
        );

        const initialState = msr.getInitialState(blocks[1]);
        expect(initialState.someNumber).to.equal(10 + blocks[1].number);
    });

    fnIt<MappedStateReducer<any, any, any, any>>(
        m => m.getInitialState,
        "computes initial state on mapped state",
        () => {
            const msr = new MappedStateReducer(
                () => objects,
                ({ value }) => new TestAnchorStateReducer(value),
                o => o.id,
                new NullReducer()
            );

            const initialState = msr.getInitialState(blocks[0]);
            expect(Object.keys(initialState)).to.eql(["items"]);

            const expectedMap = new Map<string, TestAnchorState>();
            for (const { id, value } of objects) {
                expectedMap.set(id, { someNumber: value + blocks[0].number });
            }

            expect(initialState.items).to.deep.equal(expectedMap);
        }
    );

    fnIt<MappedStateReducer<any, any, any, any>>(m => m.reduce, "computes reduces state", () => {
        const msr = new MappedStateReducer<TestAnchorState, {}, IBlockStub, { id: string }>(
            () => [],
            () => new NullReducer(),
            o => o.id,
            new TestAnchorStateReducer(10)
        );

        const initialState = msr.getInitialState(blocks[1]);
        const reducedState = msr.reduce(initialState, blocks[2]);

        expect(reducedState.someNumber).to.equal(10 + blocks[1].number + blocks[2].number);
    });

    fnIt<MappedStateReducer<any, any, any, any>>(m => m.reduce, "computes state on mapped states", () => {
        const msr = new MappedStateReducer(
            () => objects,
            ({ value }) => new TestAnchorStateReducer(value),
            o => o.id,
            new NullReducer()
        );

        const items = new Map<string, TestAnchorState>();
        items.set(objects[0].id, { someNumber: objects[0].value });
        items.set(objects[1].id, { someNumber: objects[1].value });
        items.set(objects[2].id, { someNumber: objects[2].value });
        const initialState = { items };

        const reducedState = msr.reduce(initialState, blocks[1]);

        expect(Object.keys(reducedState)).to.eql(["items"]);

        const expectedMap = new Map<string, TestAnchorState>();
        for (const { id, value } of objects) {
            expectedMap.set(id, { someNumber: value + blocks[1].number });
        }

        expect(reducedState.items).to.deep.equal(expectedMap);
    });

    fnIt<MappedStateReducer<any, any, any, any>>(
        m => m.reduce,
        "calls getInitialState if a new object id is added to the collection",
        () => {
            // start with only two objects
            const items = new Map<string, TestAnchorState>();
            items.set(objects[0].id, { someNumber: objects[0].value + blocks[0].number });
            items.set(objects[1].id, { someNumber: objects[1].value + blocks[0].number });
            const initialState = { items };

            // now call the reducer with all the three objects
            const msr = new MappedStateReducer(
                () => objects,
                ({ value }) => new TestAnchorStateReducer(value),
                o => o.id,
                new NullReducer()
            );

            const reducedState = msr.reduce(initialState, blocks[1]);

            expect(Object.keys(reducedState)).to.eql(["items"]);

            const expectedMap = new Map<string, TestAnchorState>();
            expectedMap.set(objects[0].id, { someNumber: objects[0].value + blocks[0].number + blocks[1].number });
            expectedMap.set(objects[1].id, { someNumber: objects[1].value + blocks[0].number + blocks[1].number });
            expectedMap.set(objects[2].id, { someNumber: objects[2].value + blocks[1].number }); // no block[0]!

            expect(reducedState.items).to.deep.equal(expectedMap);
        }
    );
});

describe("BlockNumberReducer", () => {
    fnIt<BlockNumberReducer>(m => m.getInitialState, "sets current block number", () => {
        const reducer = new BlockNumberReducer();
        const anchorState = reducer.getInitialState(blocks[0]);

        expect(anchorState.blockNumber).to.equal(blocks[0].number);
    });

    fnIt<BlockNumberReducer>(m => m.getInitialState, "sets current block number", () => {
        const reducer = new BlockNumberReducer();

        const nextAnchorState = reducer.reduce({ blockNumber: 0 }, blocks[2]);

        expect(nextAnchorState.blockNumber).to.equal(blocks[2].number);
    });
});
