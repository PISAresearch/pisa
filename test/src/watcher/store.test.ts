import "mocha";
import { expect } from "chai";
import { mock, instance, when } from "ts-mockito";
import { AppointmentStore } from "../../../src/watcher";
import levelup, { LevelUp } from "levelup";
import MemDown from "memdown";
import encodingDown from "encoding-down";
import { KitsuneAppointment } from "../../../src/integrations/kitsune";
import { ChannelType, IEthereumAppointment } from "../../../src/dataEntities";

const getAppointment = (id: string, stateLocator: string, endBlock: number, nonce: number) => {
    const appointmentMock = mock(KitsuneAppointment);
    when(appointmentMock.id).thenReturn(id);
    when(appointmentMock.getStateLocator()).thenReturn(stateLocator);
    when(appointmentMock.type).thenReturn("test" as any);
    when(appointmentMock.endBlock).thenReturn(endBlock);
    when(appointmentMock.getStateNonce()).thenReturn(nonce);
    when(appointmentMock.getDBRepresentation()).thenReturn({
        id,
        endBlock,
        stateLocator,
        nonce,
        type: "test"
    } as any);

    const appointment = instance(appointmentMock);

    return {
        mock: appointmentMock,
        object: appointment
    };
};

describe("Store", () => {
    let db: LevelUp<encodingDown<string, any>>, store: AppointmentStore;

    beforeEach(async () => {
        db = levelup(
            encodingDown<string, any>(MemDown(), {
                valueEncoding: "json"
            })
        );

        const map = new Map([
            [
                "test" as ChannelType,
                (obj: any) => getAppointment(obj.id, obj.stateLocator, obj.endBlock, obj.nonce).object
            ]
        ]);
        store = new AppointmentStore(db, map);
        await store.start();
    });

    afterEach(async () => {
        await store.stop();
        await db.close();
    });

    it("addOrUpdate does add appointment", async () => {
        const appointment1 = getAppointment("id1", "stateLocator1", 5, 1);
        const result = await store.addOrUpdateByStateLocator(appointment1.object);
        expect(result).to.be.true;

        const storedAppointments = [...store.getExpiredSince(appointment1.object.endBlock + 1)];
        expect(storedAppointments).to.deep.equal([appointment1.object]);

        const dbApp = await db.get(appointment1.object.id);
        expect(dbApp).to.deep.equal(appointment1.object.getDBRepresentation());
    });

    it("addOrUpdate does add multiple appointments", async () => {
        const appointment1 = getAppointment("id1", "stateLocator1", 1, 1);
        const appointment2 = getAppointment("id2", "stateLocator2", 1, 1);

        const result = await store.addOrUpdateByStateLocator(appointment1.object);
        expect(result).to.be.true;
        const result2 = await store.addOrUpdateByStateLocator(appointment2.object);
        expect(result2).to.be.true;

        const storedAppointments = [...store.getExpiredSince(appointment1.object.endBlock + 1)];
        expect(storedAppointments).to.deep.equal([appointment1.object, appointment2.object]);

        const dbAppointment1 = await db.get(appointment1.object.id);
        expect(dbAppointment1).to.deep.equal(appointment1.object.getDBRepresentation());
        const dbAppointment2 = await db.get(appointment2.object.id);
        expect(dbAppointment2).to.deep.equal(appointment2.object.getDBRepresentation());
    });

    it("addOrUpdate does update older appointment", async () => {
        const appointment1 = getAppointment("id1", "stateLocator1", 1, 1);
        const appointment2 = getAppointment("id2", "stateLocator1", 1, 2);

        // first appointment is accepted
        const result1 = await store.addOrUpdateByStateLocator(appointment1.object);
        expect(result1).to.be.true;

        // second is also
        const result2 = await store.addOrUpdateByStateLocator(appointment2.object);
        expect(result2).to.be.true;

        const storedAppointments = [...store.getExpiredSince(appointment2.object.endBlock + 1)];
        expect(storedAppointments).to.deep.equal([appointment2.object]);

        const dbAppointment2 = await db.get(appointment2.object.id);
        expect(dbAppointment2).to.deep.equal(appointment2.object.getDBRepresentation());
    });

    it("addOrUpdate does not update newer appointment", async () => {
        const appointment1 = getAppointment("id1", "stateLocator1", 1, 1);
        const appointment2 = getAppointment("id2", "stateLocator1", 1, 2);

        // second is added
        const result2 = await store.addOrUpdateByStateLocator(appointment2.object);
        expect(result2).to.be.true;

        // first is not accepted
        const result1 = await store.addOrUpdateByStateLocator(appointment1.object);
        expect(result1).to.be.false;

        const storedAppointments = [...store.getExpiredSince(appointment2.object.endBlock + 1)];
        expect(storedAppointments).to.deep.equal([appointment2.object]);

        const dbAppointment2 = await db.get(appointment2.object.id);
        expect(dbAppointment2).to.deep.equal(appointment2.object.getDBRepresentation());
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
        const appointment1 = getAppointment("id1", "stateLocator1", 1, 1);

        // second is added
        await store.addOrUpdateByStateLocator(appointment1.object);
        const result = await store.removeById(appointment1.object.id);
        expect(result).to.be.true;

        expect([...(await store.getExpiredSince(appointment1.object.endBlock + 1))]).to.deep.equal([]);

        expectNotFound(() => db.get(appointment1.object.id));
    });
    it("removeById does not remove appointment already removed", async () => {
        const appointment1 = getAppointment("id1", "stateLocator1", 1, 1);

        // second is added
        await store.addOrUpdateByStateLocator(appointment1.object);
        const result = await store.removeById(appointment1.object.id);
        expect(result).to.be.true;
        const result2 = await store.removeById(appointment1.object.id);
        expect(result2).to.be.false;

        expect([...(await store.getExpiredSince(appointment1.object.endBlock + 1))]).to.deep.equal([]);
        expectNotFound(() => db.get(appointment1.object.id));
    });

    it("removeById does not remove non-existant appointment", async () => {
        const appointment1 = getAppointment("id1", "stateLocator1", 1, 1);
        const appointment2 = getAppointment("id2", "stateLocator2", 1, 1);

        await store.addOrUpdateByStateLocator(appointment1.object);
        const result = await store.removeById(appointment2.object.id);
        expect(result).to.be.false;

        expect([...(await store.getExpiredSince(appointment1.object.endBlock + 1))]).to.deep.equal([
            appointment1.object
        ]);
        const dbAppointment1 = await db.get(appointment1.object.id);
        expect(dbAppointment1).to.deep.equal(appointment1.object.getDBRepresentation());
    });

    it("removeById does allow add after remove", async () => {
        const appointment1 = getAppointment("id1", "stateLocator1", 1, 1);

        await store.addOrUpdateByStateLocator(appointment1.object);
        await store.removeById(appointment1.object.id);
        const result = await store.addOrUpdateByStateLocator(appointment1.object);
        expect(result).to.be.true;

        const dbAppointment1 = await db.get(appointment1.object.id);
        expect(dbAppointment1).to.deep.equal(appointment1.object.getDBRepresentation());
        expect([...(await store.getExpiredSince(appointment1.object.endBlock + 1))]).to.deep.equal([
            appointment1.object
        ]);
    });

    it("removeById does not remove other appointments", async () => {
        const appointment1 = getAppointment("id1", "stateLocator1", 1, 1);
        const appointment2 = getAppointment("id2", "stateLocator2", 1, 1);

        await store.addOrUpdateByStateLocator(appointment1.object);
        await store.addOrUpdateByStateLocator(appointment2.object);
        const result = await store.removeById(appointment1.object.id);
        expect(result).to.be.true;

        expectNotFound(() => db.get(appointment1.object.id));

        const dbAppointment2 = await db.get(appointment2.object.id);
        expect(dbAppointment2).to.deep.equal(appointment2.object.getDBRepresentation());
        expect([...(await store.getExpiredSince(appointment1.object.endBlock + 1))]).to.deep.equal([
            appointment2.object
        ]);
    });

    it("expiredSince fetches items with end block less than supplied", async () => {
        const appointment1 = getAppointment("id1", "stateLocator1", 1, 1);
        const appointment2 = getAppointment("id2", "stateLocator2", 5, 1);
        const appointment3 = getAppointment("id3", "stateLocator3", 10, 1);

        await store.addOrUpdateByStateLocator(appointment1.object);
        await store.addOrUpdateByStateLocator(appointment2.object);
        await store.addOrUpdateByStateLocator(appointment3.object);

        expect([...(await store.getExpiredSince(5))]).to.deep.equal([appointment1.object]);
    });

    const expectAppointmentEquals = (actual: IEthereumAppointment, expected: IEthereumAppointment) => {
        expect(actual.id).to.equal(expected.id);
        expect(actual.getStateNonce()).to.equal(expected.getStateNonce());
        expect(actual.getStateLocator()).to.equal(expected.getStateLocator());
        expect(actual.endBlock).to.equal(expected.endBlock);
    };

    it("startup does load all appointments", async () => {
        const appointment1 = getAppointment("id1", "stateLocator1", 1, 1);
        const appointment2 = getAppointment("id2", "stateLocator2", 5, 1);
        const appointment3 = getAppointment("id3", "stateLocator3", 10, 1);
        const appointment4 = getAppointment("id4", "stateLocator3", 10, 2);

        const testDB = levelup(
            encodingDown<string, any>(MemDown(), {
                valueEncoding: "json"
            })
        );

        // add items to the store
        await testDB.put(appointment1.object.id, appointment1.object.getDBRepresentation());
        await testDB.put(appointment2.object.id, appointment2.object.getDBRepresentation());
        await testDB.put(appointment3.object.id, appointment3.object.getDBRepresentation());

        const map = new Map();
        map.set("test", (obj: any) => getAppointment(obj.id, obj.stateLocator, obj.endBlock, obj.nonce).object);
        const testStore = new AppointmentStore(testDB, map);
        await testStore.start();

        let expired = [...(await testStore.getExpiredSince(appointment3.object.endBlock + 1))];
        expectAppointmentEquals(expired[0], appointment1.object);
        expectAppointmentEquals(expired[1], appointment2.object);
        expectAppointmentEquals(expired[2], appointment3.object);
        // now check an update
        await testStore.addOrUpdateByStateLocator(appointment4.object);

        expired = [...(await testStore.getExpiredSince(appointment3.object.endBlock + 1))];
        expectAppointmentEquals(expired[0], appointment1.object);
        expectAppointmentEquals(expired[1], appointment2.object);
        expectAppointmentEquals(expired[2], appointment4.object);

        await testStore.stop();
    });

    it("getAll returns all appointments", async () => {
        const appointment1 = getAppointment("id1", "stateLocator1", 1, 1);
        const appointment2 = getAppointment("id2", "stateLocator2", 500000000000, 1);
        const appointment3 = getAppointment("id3", "stateLocator3", 10, 1);
        const appointment3A = getAppointment("id4", "stateLocator3", 1000000000000000, 2);

        await store.addOrUpdateByStateLocator(appointment1.object);
        await store.addOrUpdateByStateLocator(appointment2.object);
        await store.addOrUpdateByStateLocator(appointment3.object);
        await store.addOrUpdateByStateLocator(appointment3A.object);

        const appointments = store.getAll();

        expectAppointmentEquals(appointments[0], appointment1.object);
        expectAppointmentEquals(appointments[1], appointment2.object);
        expectAppointmentEquals(appointments[2], appointment3A.object);
    });
});
