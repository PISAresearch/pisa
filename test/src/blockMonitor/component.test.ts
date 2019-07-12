import "mocha";
import { expect } from "chai";
import { MappedStateReducer, StateReducer } from "../../../src/blockMonitor/component";
import { IBlockStub } from "../../../src/dataEntities/block";

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

    it("correctly computes the initial state", () => {
        const msr = new MappedStateReducer(() => objects, ({ value }) => new TestAnchorStateReducer(value));

        const initialState = msr.getInitialState(blocks[0]);
        expect(Object.keys(initialState)).to.eql(["items"]);

        const expectedMap = new Map<string, TestAnchorState>();
        for (const { id, value } of objects) {
            expectedMap.set(id, { someNumber: value + blocks[0].number });
        }

        expect(initialState.items).to.deep.equal(expectedMap);
    });

    it("correctly reduces the combined state", () => {
        const msr = new MappedStateReducer(() => objects, ({ value }) => new TestAnchorStateReducer(value));

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

    it("initializes to the initial state if a new object id is added to the collection", () => {
        // start with only two objects
        const items = new Map<string, TestAnchorState>();
        items.set(objects[0].id, { someNumber: objects[0].value + blocks[0].number });
        items.set(objects[1].id, { someNumber: objects[1].value + blocks[0].number });
        const initialState = { items };

        // now call the reducer with all the three objects
        const msr = new MappedStateReducer(() => objects, ({ value }) => new TestAnchorStateReducer(value));

        const reducedState = msr.reduce(initialState, blocks[1]);

        expect(Object.keys(reducedState)).to.eql(["items"]);

        const expectedMap = new Map<string, TestAnchorState>();
        expectedMap.set(objects[0].id, { someNumber: objects[0].value + blocks[0].number + blocks[1].number });
        expectedMap.set(objects[1].id, { someNumber: objects[1].value + blocks[0].number + blocks[1].number });
        expectedMap.set(objects[2].id, { someNumber: objects[2].value + blocks[1].number }); // no block[0]!

        expect(reducedState.items).to.deep.equal(expectedMap);
    });
});
