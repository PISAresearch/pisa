import "mocha";
import { ResponderAppointmentReducer, ResponderStateKind } from "../../../src/responder/component";
import { BlockCache } from "../../../src/blockMonitor";
import { PisaTransactionIdentifier } from "../../../src/responder/gasQueue";
import { BigNumber } from "ethers/utils";
import { ResponderBlock, TransactionStub } from "../../../src/dataEntities/block";
import { expect } from "chai";

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
