import "mocha";
import {
    ResponderAppointmentReducer,
    ResponderStateKind,
    MultiResponderComponent,
    ResponderAnchorState,
    ResponderAppointmentAnchorState,
    PendingResponseState,
    MinedResponseState
} from "../../../src/responder/component";
import { BlockCache } from "../../../src/blockMonitor";
import { PisaTransactionIdentifier } from "../../../src/responder/gasQueue";
import { BigNumber } from "ethers/utils";
import { ResponderBlock, TransactionStub, Block } from "../../../src/dataEntities/block";
import { expect } from "chai";
import { MultiResponder } from "../../../src/responder";
import { mock, instance, verify, anything, capture } from "ts-mockito";

const from1 = "from1";
const from2 = "from2";

const newIdentifierAndTransaction = (blockNumber: number, data: string, from: string, nonce: number) => {
    const chainId = 1;
    const to = "to";
    const value = new BigNumber(0);
    const gasLimit = new BigNumber(200);
    const tx: TransactionStub = {
        blockNumber,
        chainId,
        data,
        from,
        gasLimit,
        nonce,
        to,
        value
    };
    const identifier = new PisaTransactionIdentifier(chainId, data, to, value, gasLimit);
    return {
        identifier,
        tx
    };
};
const appointmentId1 = "app1";
const txID1 = newIdentifierAndTransaction(1, "data1", from1, 1);
// different from address
const txID2 = newIdentifierAndTransaction(2, "data1", from2, 2);

const blocks: ResponderBlock[] = [
    {
        hash: "hash0",
        number: 0,
        parentHash: "hash",
        transactions: []
    },
    {
        hash: "hash1",
        number: 1,
        parentHash: "hash0",
        transactions: [txID1.tx]
    },
    {
        hash: "hash2",
        number: 2,
        parentHash: "hash1",
        transactions: [txID2.tx]
    }
];

describe("ResponderAppointmentReducer", () => {
    let blockCache: BlockCache<ResponderBlock>;

    beforeEach(() => {
        blockCache = new BlockCache<ResponderBlock>(100);
        blocks.forEach(b => blockCache.addBlock(b));
    });

    it("getInitialState sets pending tx", () => {
        const reducer = new ResponderAppointmentReducer(blockCache, txID1.identifier, appointmentId1, from1);

        const anchorState = reducer.getInitialState(blocks[0]);
        expect(anchorState.identifier).to.equal(txID1.identifier);
        expect(anchorState.appointmentId).to.equal(appointmentId1);
        expect(anchorState.kind).to.equal(ResponderStateKind.Pending);
    });

    it("getInitialState sets mined tx", () => {
        const reducer = new ResponderAppointmentReducer(blockCache, txID1.identifier, appointmentId1, from1);

        const anchorState = reducer.getInitialState(blocks[2]);

        expect(anchorState.kind).to.equal(ResponderStateKind.Mined);
        if (anchorState.kind === ResponderStateKind.Mined) {
            expect(anchorState.identifier).to.equal(txID1.identifier);
            expect(anchorState.appointmentId).to.equal(appointmentId1);
            expect(anchorState.blockMined).to.equal(txID1.tx.blockNumber);
            expect(anchorState.nonce).to.equal(txID1.tx.nonce);
        }
    });

    it("reduce keeps pending as pending", () => {
        const reducer = new ResponderAppointmentReducer(blockCache, txID1.identifier, appointmentId1, from1);

        const prevAnchorState = reducer.getInitialState(blocks[0]);
        const nextAnchorState = reducer.reduce(prevAnchorState, blocks[0]);

        expect(nextAnchorState.identifier).to.equal(txID1.identifier);
        expect(nextAnchorState.appointmentId).to.equal(appointmentId1);
        expect(nextAnchorState.kind).to.equal(ResponderStateKind.Pending);
    });

    it("reduce transitions from pending to mined", () => {
        const reducer = new ResponderAppointmentReducer(blockCache, txID1.identifier, appointmentId1, from1);

        const prevAnchorState = reducer.getInitialState(blocks[0]);
        const nextAnchorState = reducer.reduce(prevAnchorState, blocks[1]);

        expect(nextAnchorState.kind).to.equal(ResponderStateKind.Mined);
        if (nextAnchorState.kind === ResponderStateKind.Mined) {
            expect(nextAnchorState.identifier).to.equal(txID1.identifier);
            expect(nextAnchorState.appointmentId).to.equal(appointmentId1);
            expect(nextAnchorState.blockMined).to.equal(txID1.tx.blockNumber);
            expect(nextAnchorState.nonce).to.equal(txID1.tx.nonce);
        }
    });

    it("reduce keeps mined as mined", () => {
        const reducer = new ResponderAppointmentReducer(blockCache, txID1.identifier, appointmentId1, from1);

        const prevAnchorState = reducer.getInitialState(blocks[0]);
        const nextAnchorState = reducer.reduce(prevAnchorState, blocks[1]);
        const nextNextAnchorState = reducer.reduce(nextAnchorState, blocks[2]);

        expect(nextAnchorState).to.equal(nextNextAnchorState);
    });

    it("reduce doesnt mine tx from different address", () => {
        const reducer = new ResponderAppointmentReducer(blockCache, txID1.identifier, appointmentId1, from1);

        // setup pending
        const prevAnchorState = reducer.getInitialState(blocks[0]);

        // mine a block with the same txidentifier but a different 'from'
        const nextAnchorState = reducer.reduce(prevAnchorState, blocks[2]);

        expect(nextAnchorState.identifier).to.equal(txID1.identifier);
        expect(nextAnchorState.appointmentId).to.equal(appointmentId1);
        expect(nextAnchorState.kind).to.equal(ResponderStateKind.Pending);
    });
});

const pendingAppointmentState = (appointmentId: string, data: string): PendingResponseState => {
    const identifier = new PisaTransactionIdentifier(1, data, "to", new BigNumber(0), new BigNumber(200));
    return {
        appointmentId,
        identifier,
        kind: ResponderStateKind.Pending
    };
};

const minedAppointmentState = (
    appointmentId: string,
    data: string,
    blockMined: number,
    nonce: number
): MinedResponseState => {
    const identifier = new PisaTransactionIdentifier(1, data, "to", new BigNumber(0), new BigNumber(200));
    return {
        appointmentId,
        blockMined,
        identifier,
        kind: ResponderStateKind.Mined,
        nonce
    };
};

const setupState = (states: ResponderAppointmentAnchorState[], blockNumber: number): ResponderAnchorState => {
    const items = new Map<string, ResponderAppointmentAnchorState>();
    states.forEach(s => items.set(s.appointmentId, s));
    return {
        blockNumber,
        items
    };
};

describe("MultiResponderComponent", () => {
    let multiResponderMock: MultiResponder,
        multiResponder: MultiResponder,
        blockCacheMock: BlockCache<Block>,
        blockCache: BlockCache<Block>;
    const confirmationsRequired = 5;

    beforeEach(() => {
        multiResponderMock = mock(MultiResponder);
        multiResponder = instance(multiResponderMock);
        blockCacheMock = mock(BlockCache);
        blockCache = instance(blockCacheMock);
    });

    it("handleChanges reEnqueues all pending items", async () => {
        const app1State = pendingAppointmentState("app1", "data1");
        const app2State = minedAppointmentState("app2", "data2", 0, 0);
        const state1 = setupState([app1State, app2State], 0);
        const state2 = setupState([app1State, app2State], 1);
        const component = new MultiResponderComponent(multiResponder, blockCache, confirmationsRequired);

        await component.handleChanges(state1, state2);

        const [firstArg] = capture(multiResponderMock.reEnqueueMissingItems).last();
        expect(firstArg).to.deep.equal(["app1"]);
    });

    it("handleChanges detects response has been mined", async () => {
        const app1State = pendingAppointmentState("app1", "data1");
        const app2State = minedAppointmentState("app1", "data1", 0, 0);
        const state1 = setupState([app1State], 0);
        // two block difference
        const state2 = setupState([app2State], 2);
        const component = new MultiResponderComponent(multiResponder, blockCache, confirmationsRequired);

        await component.handleChanges(state1, state2);

        const [identifier, nonce] = capture(multiResponderMock.txMined).last();
        expect(identifier).to.deep.equal(app2State.identifier);
        expect(nonce).to.equal(app2State.nonce);
    });

    it("handleChanges detects newly mined item", async () => {
        const app2State = minedAppointmentState("app1", "data1", 0, 0);
        const state1 = setupState([], 0);
        // two block difference
        const state2 = setupState([app2State], 2);
        const component = new MultiResponderComponent(multiResponder, blockCache, confirmationsRequired);

        await component.handleChanges(state1, state2);

        const [identifier, nonce] = capture(multiResponderMock.txMined).last();
        expect(identifier).to.deep.equal(app2State.identifier);
        expect(nonce).to.equal(app2State.nonce);
    });

    it("handleChanges doesnt detect already mined response", async () => {
        const app2State = minedAppointmentState("app1", "data1", 0, 0);
        const state1 = setupState([app2State], 0);
        // two block difference
        const state2 = setupState([app2State], 2);
        const component = new MultiResponderComponent(multiResponder, blockCache, confirmationsRequired);

        await component.handleChanges(state1, state2);

        verify(multiResponderMock.txMined(anything(), anything())).never();
    });

    it("handleChanges removes item after confirmations", async () => {
        const app2State = minedAppointmentState("app1", "data1", 0, 0);
        const state1 = setupState([app2State], 0);
        // two block difference
        const state2 = setupState([app2State], confirmationsRequired + 1);
        const component = new MultiResponderComponent(multiResponder, blockCache, confirmationsRequired);

        await component.handleChanges(state1, state2);

        const [appointmentId] = capture(multiResponderMock.endResponse).last();
        expect(appointmentId).to.equal(app2State.appointmentId);
    });

    it("handleChanges removes item after confirmations from pending", async () => {
        const app1State = pendingAppointmentState("app1", "data1");
        const app2State = minedAppointmentState("app1", "data1", 0, 0);
        const state1 = setupState([app1State], 0);
        // two block difference
        const state2 = setupState([app2State], confirmationsRequired + 1);
        const component = new MultiResponderComponent(multiResponder, blockCache, confirmationsRequired);

        await component.handleChanges(state1, state2);

        const [appointmentId] = capture(multiResponderMock.endResponse).last();
        expect(appointmentId).to.equal(app2State.appointmentId);
    });

    it("handleChanges removes item after confirmations from empty", async () => {
        const app2State = minedAppointmentState("app1", "data1", 0, 0);
        const state1 = setupState([], 0);
        // two block difference
        const state2 = setupState([app2State], confirmationsRequired + 1);
        const component = new MultiResponderComponent(multiResponder, blockCache, confirmationsRequired);

        await component.handleChanges(state1, state2);

        const [appointmentId] = capture(multiResponderMock.endResponse).last();
        expect(appointmentId).to.equal(app2State.appointmentId);
    });

    it("handleChanges does not try to remove already removed item", async () => {
        const app2State = minedAppointmentState("app1", "data1", 0, 0);
        const state1 = setupState([app2State], confirmationsRequired + 1);
        // already removed - then one block later
        const state2 = setupState([app2State], confirmationsRequired + 2);
        const component = new MultiResponderComponent(multiResponder, blockCache, confirmationsRequired);

        await component.handleChanges(state1, state2);

        verify(multiResponderMock.endResponse(anything())).never();
    });
});
