import "mocha";
import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import { AppointmentStore } from "../../src/watcher";
import levelup, { LevelUp } from "levelup";
import MemDown from "memdown";
import encodingDown from "encoding-down";
import { Appointment } from "../../src/dataEntities/appointment";
import { ApplicationError } from "@pisa-research/errors";
import { fnIt, expectAsync } from "@pisa-research/test-utils";
import { DbObject } from "@pisa-research/utils";
chai.use(chaiAsPromised);

const getAppointment = (id: string, endBlock: number, nonce: number) => {
    return Appointment.fromIAppointment({
        challengePeriod: 10,
        contractAddress: "contractAddress",
        customerAddress: "customerAddress",
        data: "data",
        endBlock,
        eventAddress: "contractAddress",
        topics: [],
        gasLimit: 100,
        customerChosenId: id,
        nonce: nonce,
        mode: 1,
        paymentHash: "paymentHash",
        preCondition: "precondition",
        postCondition: "postCondition",
        refund: "3",
        startBlock: 7,
        customerSig: "sig"
    });
};

describe("Store", () => {
    let db: LevelUp<encodingDown<string, DbObject>>, store: AppointmentStore;

    beforeEach(async () => {
        db = levelup(
            encodingDown<string, DbObject>(MemDown(), {
                valueEncoding: "json"
            })
        );
        store = new AppointmentStore(db);
        await store.start();
    });

    afterEach(async () => {
        await store.stop();
        await db.close();
    });

    const subDbString = "!watcher!";

    fnIt<AppointmentStore>(s => s.addOrUpdateByLocator, "does add appointment", async () => {
        const appointment1 = getAppointment("0x0000000000000000000000000000000000000000000000000000000000000001", 5, 1);
        await store.addOrUpdateByLocator(appointment1);

        const storedAppointments = [...store.getExpiredSince(appointment1.endBlock + 1)];
        expect(storedAppointments).to.deep.equal([appointment1]);

        const dbApp = await db.get(subDbString + appointment1.id);
        expect(dbApp).to.deep.equal(appointment1.serialise());
    });

    fnIt<AppointmentStore>(s => s.addOrUpdateByLocator, "does add multiple appointments", async () => {
        const appointment1 = getAppointment("0x0000000000000000000000000000000000000000000000000000000000000001", 1, 1);
        const appointment2 = getAppointment("0x0000000000000000000000000000000000000000000000000000000000000002", 1, 1);

        await store.addOrUpdateByLocator(appointment1);
        await store.addOrUpdateByLocator(appointment2);

        const storedAppointments = [...store.getExpiredSince(appointment1.endBlock + 1)];
        expect(storedAppointments).to.deep.equal([appointment1, appointment2]);

        const dbAppointment1 = await db.get(subDbString + appointment1.id);
        expect(dbAppointment1).to.deep.equal(appointment1.serialise());
        const dbAppointment2 = await db.get(subDbString + appointment2.id);
        expect(dbAppointment2).to.deep.equal(appointment2.serialise());
    });

    fnIt<AppointmentStore>(s => s.addOrUpdateByLocator, "does update older appointment", async () => {
        const appointment1 = getAppointment("0x0000000000000000000000000000000000000000000000000000000000000001", 1, 1);
        const appointment2 = getAppointment("0x0000000000000000000000000000000000000000000000000000000000000001", 1, 2);

        // first appointment is accepted
        await store.addOrUpdateByLocator(appointment1);

        // second is also
        await store.addOrUpdateByLocator(appointment2);

        const storedAppointments = [...store.getExpiredSince(appointment2.endBlock + 1)];
        expect(storedAppointments).to.deep.equal([appointment2]);

        const dbAppointment2 = await db.get(subDbString + appointment2.id);
        expect(dbAppointment2).to.deep.equal(appointment2.serialise());
    });

    fnIt<AppointmentStore>(s => s.addOrUpdateByLocator, "does not update newer appointment", async () => {
        const appointment1 = getAppointment("0x0000000000000000000000000000000000000000000000000000000000000001", 1, 1);
        const appointment2 = getAppointment("0x0000000000000000000000000000000000000000000000000000000000000001", 1, 2);

        // second is added
        await store.addOrUpdateByLocator(appointment2);

        // first is not accepted
        (await expectAsync(store.addOrUpdateByLocator(appointment1))).to.throw(ApplicationError);

        const storedAppointments = [...store.getExpiredSince(appointment2.endBlock + 1)];
        expect(storedAppointments).to.deep.equal([appointment2]);

        const dbAppointment2 = await db.get(subDbString + appointment2.id);
        expect(dbAppointment2).to.deep.equal(appointment2.serialise());
    });

    const expectNotFound = async (func: () => Promise<any>) => {
        try {
            await func();
            expect(true).to.be.false;
        } catch (doh) {
            expect(doh.notFound).to.be.true;
        }
    };
    fnIt<AppointmentStore>(s => s.removeById, "does remove appointment", async () => {
        const appointment1 = getAppointment("0x0000000000000000000000000000000000000000000000000000000000000001", 1, 1);

        // second is added
        await store.addOrUpdateByLocator(appointment1);
        const result = await store.removeById(appointment1.id);
        expect(result).to.be.true;

        expect([...(store.getExpiredSince(appointment1.endBlock + 1))]).to.deep.equal([]);

        expectNotFound(() => db.get(appointment1.id));
    });

    fnIt<AppointmentStore>(s => s.removeById, "does not remove appointment already removed", async () => {
        const appointment1 = getAppointment("0x0000000000000000000000000000000000000000000000000000000000000001", 1, 1);

        // second is added
        await store.addOrUpdateByLocator(appointment1);
        const result = await store.removeById(appointment1.id);
        expect(result).to.be.true;
        const result2 = await store.removeById(appointment1.id);
        expect(result2).to.be.false;

        expect([...store.getExpiredSince(appointment1.endBlock + 1)]).to.deep.equal([]);
        expectNotFound(() => db.get(subDbString + appointment1.id));
    });

    fnIt<AppointmentStore>(s => s.removeById, "does not remove non-existent appointment", async () => {
        const appointment1 = getAppointment("0x0000000000000000000000000000000000000000000000000000000000000001", 1, 1);
        const appointment2 = getAppointment("0x0000000000000000000000000000000000000000000000000000000000000002", 1, 1);

        await store.addOrUpdateByLocator(appointment1);
        const result = await store.removeById(appointment2.id);
        expect(result).to.be.false;

        expect([...store.getExpiredSince(appointment1.endBlock + 1)]).to.deep.equal([appointment1]);
        const dbAppointment1 = await db.get(subDbString + appointment1.id);
        expect(dbAppointment1).to.deep.equal(appointment1.serialise());
    });

    fnIt<AppointmentStore>(s => s.removeById, "does allow add after remove", async () => {
        const appointment1 = getAppointment("0x0000000000000000000000000000000000000000000000000000000000000001", 1, 1);

        await store.addOrUpdateByLocator(appointment1);
        await store.removeById(appointment1.id);
        await store.addOrUpdateByLocator(appointment1);

        const dbAppointment1 = await db.get(subDbString + appointment1.id);
        expect(dbAppointment1).to.deep.equal(appointment1.serialise());
        expect([...store.getExpiredSince(appointment1.endBlock + 1)]).to.deep.equal([appointment1]);
    });

    fnIt<AppointmentStore>(s => s.removeById, "does not remove other appointments", async () => {
        const appointment1 = getAppointment("0x0000000000000000000000000000000000000000000000000000000000000001", 1, 1);
        const appointment2 = getAppointment("0x0000000000000000000000000000000000000000000000000000000000000002", 1, 1);

        await store.addOrUpdateByLocator(appointment1);
        await store.addOrUpdateByLocator(appointment2);
        const result = await store.removeById(appointment1.id);
        expect(result).to.be.true;

        expectNotFound(() => db.get(appointment1.id));

        const dbAppointment2 = await db.get(subDbString + appointment2.id);
        expect(dbAppointment2).to.deep.equal(appointment2.serialise());
        expect([...store.getExpiredSince(appointment1.endBlock + 1)]).to.deep.equal([appointment2]);
    });

    fnIt<AppointmentStore>(s => s.getExpiredSince, "fetches items with end block less than supplied", async () => {
        const appointment1 = getAppointment("0x0000000000000000000000000000000000000000000000000000000000000001", 1, 1);
        const appointment2 = getAppointment("0x0000000000000000000000000000000000000000000000000000000000000002", 5, 1);
        const appointment3 = getAppointment("0x0000000000000000000000000000000000000000000000000000000000000003", 10, 1);

        await store.addOrUpdateByLocator(appointment1);
        await store.addOrUpdateByLocator(appointment2);
        await store.addOrUpdateByLocator(appointment3);

        expect([...store.getExpiredSince(5)]).to.deep.equal([appointment1]);
    });

    it("startup does load all appointments", async () => {
        const appointment1 = getAppointment("0x0000000000000000000000000000000000000000000000000000000000000001", 1, 1);
        const appointment2 = getAppointment("0x0000000000000000000000000000000000000000000000000000000000000002", 5, 1);
        const appointment3 = getAppointment("0x0000000000000000000000000000000000000000000000000000000000000003", 10, 1);
        const appointment4 = getAppointment("0x0000000000000000000000000000000000000000000000000000000000000003", 10, 2);

        const testDB = levelup(
            encodingDown<string, any>(MemDown(), {
                valueEncoding: "json"
            })
        );

        // add items to the store's DB
        await testDB.put(subDbString + appointment1.id, appointment1.serialise());
        await testDB.put(subDbString + appointment2.id, appointment2.serialise());
        await testDB.put(subDbString + appointment3.id, appointment3.serialise());

        const testStore = new AppointmentStore(testDB);
        await testStore.start();

        let expired = [...testStore.getExpiredSince(appointment3.endBlock + 1)];
        expect(expired.length).to.equal(3);
        expect(expired[0].serialise()).to.deep.equal(appointment1.serialise());
        expect(expired[1].serialise()).to.deep.equal(appointment2.serialise());
        expect(expired[2].serialise()).to.deep.equal(appointment3.serialise());
        // now check an update
        await testStore.addOrUpdateByLocator(appointment4);

        expired = [...testStore.getExpiredSince(appointment3.endBlock + 1)];
        expect(expired.length).to.equal(3);
        expect(expired[0].serialise()).to.deep.equal(appointment1.serialise());
        expect(expired[1].serialise()).to.deep.equal(appointment2.serialise());
        expect(expired[2].serialise()).to.deep.equal(appointment4.serialise());
        await testStore.stop();
    });

    fnIt<AppointmentStore>(s => s.getAll, "returns all appointments", async () => {
        const appointment1 = getAppointment("0x0000000000000000000000000000000000000000000000000000000000000001", 1, 1);
        const appointment2 = getAppointment("0x0000000000000000000000000000000000000000000000000000000000000002", 500000000000, 1);
        const appointment3 = getAppointment("0x0000000000000000000000000000000000000000000000000000000000000003", 10, 1);
        const appointment3A = getAppointment("0x0000000000000000000000000000000000000000000000000000000000000003", 1000000000000000, 2);

        await store.addOrUpdateByLocator(appointment1);
        await store.addOrUpdateByLocator(appointment2);
        await store.addOrUpdateByLocator(appointment3);
        await store.addOrUpdateByLocator(appointment3A);

        const appointments = store.getAll();

        expect(appointments[0]).to.deep.equal(appointment1);
        expect(appointments[1]).to.deep.equal(appointment2);
        expect(appointments[2]).to.deep.equal(appointment3A);
    });
});
