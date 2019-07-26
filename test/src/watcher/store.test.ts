import "mocha";
import { expect } from "chai";
import { AppointmentStore } from "../../../src/watcher";
import levelup, { LevelUp } from "levelup";
import MemDown from "memdown";
import encodingDown from "encoding-down";
import { Appointment } from "../../../src/dataEntities";

const getAppointment = (id: number, endBlock: number, jobId: number) => {
    return Appointment.fromIAppointment({
        challengePeriod: 10,
        contractAddress: "contractAddress",
        customerAddress: "customerAddress",
        data: "data",
        endBlock,
        eventABI: "eventABI",
        eventArgs: "eventArgs",
        gas: 100,
        customerChosenId: id,
        jobId,
        mode: 1,
        paymentHash: "paymentHash",
        postCondition: "postCondition",
        refund: 3,
        startBlock: 7
    });
};

describe("Store", () => {
    let db: LevelUp<encodingDown<string, any>>, store: AppointmentStore;

    beforeEach(async () => {
        db = levelup(
            encodingDown<string, any>(MemDown(), {
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

    it("addOrUpdate does add appointment", async () => {
        const appointment1 = getAppointment(1, 5, 1);
        const result = await store.addOrUpdateByLocator(appointment1);
        expect(result).to.be.true;

        const storedAppointments = [...store.getExpiredSince(appointment1.endBlock + 1)];
        expect(storedAppointments).to.deep.equal([appointment1]);

        const dbApp = await db.get(appointment1.id);
        expect(dbApp).to.deep.equal(Appointment.toIAppointment(appointment1));
    });

    it("addOrUpdate does add multiple appointments", async () => {
        const appointment1 = getAppointment(1, 1, 1);
        const appointment2 = getAppointment(2, 1, 1);

        const result = await store.addOrUpdateByLocator(appointment1);
        expect(result).to.be.true;
        const result2 = await store.addOrUpdateByLocator(appointment2);
        expect(result2).to.be.true;

        const storedAppointments = [...store.getExpiredSince(appointment1.endBlock + 1)];
        expect(storedAppointments).to.deep.equal([appointment1, appointment2]);

        const dbAppointment1 = await db.get(appointment1.id);
        expect(dbAppointment1).to.deep.equal(Appointment.toIAppointment(appointment1));
        const dbAppointment2 = await db.get(appointment2.id);
        expect(dbAppointment2).to.deep.equal(Appointment.toIAppointment(appointment2));
    });

    it("addOrUpdate does update older appointment", async () => {
        const appointment1 = getAppointment(1, 1, 1);
        const appointment2 = getAppointment(1, 1, 2);

        // first appointment is accepted
        const result1 = await store.addOrUpdateByLocator(appointment1);
        expect(result1).to.be.true;

        // second is also
        const result2 = await store.addOrUpdateByLocator(appointment2);
        expect(result2).to.be.true;

        const storedAppointments = [...store.getExpiredSince(appointment2.endBlock + 1)];
        expect(storedAppointments).to.deep.equal([appointment2]);

        const dbAppointment2 = await db.get(appointment2.id);
        expect(dbAppointment2).to.deep.equal(Appointment.toIAppointment(appointment2));
    });

    it("addOrUpdate does not update newer appointment", async () => {
        const appointment1 = getAppointment(1, 1, 1);
        const appointment2 = getAppointment(1, 1, 2);

        // second is added
        const result2 = await store.addOrUpdateByLocator(appointment2);
        expect(result2).to.be.true;

        // first is not accepted
        const result1 = await store.addOrUpdateByLocator(appointment1);
        expect(result1).to.be.false;

        const storedAppointments = [...store.getExpiredSince(appointment2.endBlock + 1)];
        expect(storedAppointments).to.deep.equal([appointment2]);

        const dbAppointment2 = await db.get(appointment2.id);
        expect(dbAppointment2).to.deep.equal(Appointment.toIAppointment(appointment2));
    });

    const expectNotFound = async (func: () => Promise<any>) => {
        try {
            await func();
            expect(true).to.be.false;
        } catch (doh) {
            expect(doh.notFound).to.be.true;
        }
    };
    it("removeById does remove appointment", async () => {
        const appointment1 = getAppointment(1, 1, 1);

        // second is added
        await store.addOrUpdateByLocator(appointment1);
        const result = await store.removeById(appointment1.id);
        expect(result).to.be.true;

        expect([...(await store.getExpiredSince(appointment1.endBlock + 1))]).to.deep.equal([]);

        expectNotFound(() => db.get(appointment1.id));
    });
    it("removeById does not remove appointment already removed", async () => {
        const appointment1 = getAppointment(1, 1, 1);

        // second is added
        await store.addOrUpdateByLocator(appointment1);
        const result = await store.removeById(appointment1.id);
        expect(result).to.be.true;
        const result2 = await store.removeById(appointment1.id);
        expect(result2).to.be.false;

        expect([...(await store.getExpiredSince(appointment1.endBlock + 1))]).to.deep.equal([]);
        expectNotFound(() => db.get(appointment1.id));
    });

    it("removeById does not remove non-existant appointment", async () => {
        const appointment1 = getAppointment(1, 1, 1);
        const appointment2 = getAppointment(2, 1, 1);

        await store.addOrUpdateByLocator(appointment1);
        const result = await store.removeById(appointment2.id);
        expect(result).to.be.false;

        expect([...(await store.getExpiredSince(appointment1.endBlock + 1))]).to.deep.equal([
            appointment1
        ]);
        const dbAppointment1 = await db.get(appointment1.id);
        expect(dbAppointment1).to.deep.equal(Appointment.toIAppointment(appointment1));
    });

    it("removeById does allow add after remove", async () => {
        const appointment1 = getAppointment(1, 1, 1);

        await store.addOrUpdateByLocator(appointment1);
        await store.removeById(appointment1.id);
        const result = await store.addOrUpdateByLocator(appointment1);
        expect(result).to.be.true;

        const dbAppointment1 = await db.get(appointment1.id);
        expect(dbAppointment1).to.deep.equal(Appointment.toIAppointment(appointment1));
        expect([...(await store.getExpiredSince(appointment1.endBlock + 1))]).to.deep.equal([
            appointment1
        ]);
    });

    it("removeById does not remove other appointments", async () => {
        const appointment1 = getAppointment(1, 1, 1);
        const appointment2 = getAppointment(2, 1, 1);

        await store.addOrUpdateByLocator(appointment1);
        await store.addOrUpdateByLocator(appointment2);
        const result = await store.removeById(appointment1.id);
        expect(result).to.be.true;

        expectNotFound(() => db.get(appointment1.id));

        const dbAppointment2 = await db.get(appointment2.id);
        expect(dbAppointment2).to.deep.equal(Appointment.toIAppointment(appointment2));
        expect([...(await store.getExpiredSince(appointment1.endBlock + 1))]).to.deep.equal([
            appointment2
        ]);
    });

    it("expiredSince fetches items with end block less than supplied", async () => {
        const appointment1 = getAppointment(1, 1, 1);
        const appointment2 = getAppointment(2, 5, 1);
        const appointment3 = getAppointment(3, 10, 1);

        await store.addOrUpdateByLocator(appointment1);
        await store.addOrUpdateByLocator(appointment2);
        await store.addOrUpdateByLocator(appointment3);

        expect([...(await store.getExpiredSince(5))]).to.deep.equal([appointment1]);
    });

    it("startup does load all appointments", async () => {
        const appointment1 = getAppointment(1, 1, 1);
        const appointment2 = getAppointment(2, 5, 1);
        const appointment3 = getAppointment(3, 10, 1);
        const appointment4 = getAppointment(3, 10, 2);

        const testDB = levelup(
            encodingDown<string, any>(MemDown(), {
                valueEncoding: "json"
            })
        );

        // add items to the store
        await testDB.put(appointment1.id, Appointment.toIAppointment(appointment1));
        await testDB.put(appointment2.id, Appointment.toIAppointment(appointment2));
        await testDB.put(appointment3.id, Appointment.toIAppointment(appointment3));

        const testStore = new AppointmentStore(testDB);
        await testStore.start();

        let expired = [...(await testStore.getExpiredSince(appointment3.endBlock + 1))];
        expect(expired[0]).to.deep.equal(appointment1);
        expect(expired[1]).to.deep.equal(appointment2);
        expect(expired[2]).to.deep.equal(appointment3);
        // now check an update
        await testStore.addOrUpdateByLocator(appointment4);

        expired = [...(await testStore.getExpiredSince(appointment3.endBlock + 1))];
        expect(expired[0]).to.deep.equal(appointment1);
        expect(expired[1]).to.deep.equal(appointment2);
        expect(expired[2]).to.deep.equal(appointment4);
        await testStore.stop();
    });

    it("getAll returns all appointments", async () => {
        const appointment1 = getAppointment(1, 1, 1);
        const appointment2 = getAppointment(2, 500000000000, 1);
        const appointment3 = getAppointment(3, 10, 1);
        const appointment3A = getAppointment(3, 1000000000000000, 2);

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
