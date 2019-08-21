import "mocha";
import { expect } from "chai";
import fnIt from "../../utils/fnIt";
import { ResponderStore } from "../../../src/responder";
import EncodingDown from "encoding-down";
import levelup, { LevelUp } from "levelup";
import MemDown from "memdown";
import { GasQueue, GasQueueItemRequest, PisaTransactionIdentifier } from "../../../src/responder/gasQueue";
import { BigNumber } from "ethers/utils";
import { Appointment } from "../../../src/dataEntities";

describe("ResponderStore", () => {
    const responderAddress = "address";
    const seedQueue = new GasQueue([], 0, 12, 10);

    const chainId = 1;

    const createIdentifier = (data: string) => {
        return new PisaTransactionIdentifier(chainId, data, "toAddress", new BigNumber(0), new BigNumber(20));
    };
    const createAppointment = (id: number, data: string) => {
        return new Appointment("contractAddress", "customerAddress", 0, 1000, 50, id, 1, data, new BigNumber(0), new BigNumber(20), 1, "abi", "args", "preCondition", "post", "payment", "sig") //prettier-ignore
    };
    const createGasQueueRequest = (id: number, data: string, idealGas: BigNumber) => {
        return new GasQueueItemRequest(createIdentifier(data), idealGas, createAppointment(id, data), 0);
    };

    let db: LevelUp<EncodingDown<string, any>>;

    beforeEach(() => {
        db = levelup(EncodingDown<string, any>(MemDown(), { valueEncoding: "json" }));
    });

    fnIt<ResponderStore>(r => r.start, "correctly loads old state", async () => {
        const store = new ResponderStore(db, responderAddress, seedQueue);
        await store.start();

        const req1 = createGasQueueRequest(1, "data1", new BigNumber(20));
        const req2 = createGasQueueRequest(2, "data2", new BigNumber(19));
        const req3 = createGasQueueRequest(3, "data3", new BigNumber(18));
        const q = seedQueue
            .add(req1)
            .add(req2)
            .add(req3);

        await store.updateQueue(q);

        expect(store.queue).to.deep.equal(q);
        expect([...store.transactions.values()]).to.deep.equal(q.queueItems);

        await store.stop();

        // now start a new store with the same db
        const nextStore = new ResponderStore(db, responderAddress, seedQueue);
        await nextStore.start();
        expect(nextStore.queue).to.deep.equal(q);
        expect([...nextStore.transactions.values()]).to.deep.equal(q.queueItems);
    });

    fnIt<ResponderStore>(r => r.updateQueue, "keys dont collide with main db", async () => {
        await db.put(`${responderAddress}:queue`, { uhoh: "yeah" });

        // we would expect an error if a collision occurred here
        const store = new ResponderStore(db, responderAddress, seedQueue);
        await store.start();
        await store.stop();
    });

    fnIt<ResponderStore>(r => r.updateQueue, "updates the queue", async () => {
        const store = new ResponderStore(db, responderAddress, seedQueue);
        await store.start();

        const req1 = createGasQueueRequest(1, "data1", new BigNumber(20));
        const req2 = createGasQueueRequest(2, "data2", new BigNumber(19));
        const req3 = createGasQueueRequest(3, "data3", new BigNumber(18));
        const q = seedQueue
            .add(req1)
            .add(req2)
            .add(req3);

        await store.updateQueue(q);

        expect(store.queue).to.deep.equal(q);
        expect([...store.transactions.values()]).to.deep.equal(q.queueItems);
        await store.stop();
    });

    fnIt<ResponderStore>(r => r.updateQueue, "overrides existing queue", async () => {
        const store = new ResponderStore(db, responderAddress, seedQueue);
        await store.start();

        const req1 = createGasQueueRequest(1, "data1", new BigNumber(20));
        const req2 = createGasQueueRequest(2, "data2", new BigNumber(19));

        const q2 = seedQueue.add(req1).add(req2);

        await store.updateQueue(q2);

        expect(store.queue).to.deep.equal(q2);
        expect([...store.transactions.values()]).to.deep.equal(q2.queueItems);

        const req3 = createGasQueueRequest(3, "data3", new BigNumber(18));
        const q3 = q2.add(req3);

        await store.updateQueue(q3);

        expect(store.queue).to.deep.equal(q3);
        expect([...store.transactions.values()]).to.deep.equal(q3.queueItems);

        await store.stop();
    });

    fnIt<ResponderStore>(r => r.removeResponse, "deletes tx", async () => {
        const store = new ResponderStore(db, responderAddress, seedQueue);
        await store.start();

        const req1 = createGasQueueRequest(1, "data1", new BigNumber(20));
        const req2 = createGasQueueRequest(2, "data2", new BigNumber(19));

        const q2 = seedQueue.add(req1).add(req2);
        await store.updateQueue(q2);
        await store.removeResponse(req1.appointment.id);

        expect(store.queue).to.equal(q2);
        expect(store.transactions.size).to.equal(1);
        expect(store.transactions.has(req1.appointment.id)).to.be.false;

        await store.stop();
    });
});
