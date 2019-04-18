import "mocha";
import { anything, verify, resetCalls, anyString, when, mock, instance } from "ts-mockito";
import { MemoryAppointmentStore } from "../../../src/watcher";
import { KitsuneAppointment } from "../../../src/integrations/kitsune";
import { AppointmentStoreGarbageCollector } from "../../../src/watcher/garbageCollector";
import Ganache from "ganache-core";
import { ethers } from "ethers";
import { AppointmentSubscriber } from "../../../src/watcher/appointmentSubscriber";
import { wait } from "../../../src/utils";

describe("GarbageCollector", () => {
    // some constants for use in the tests
    const provider = new ethers.providers.Web3Provider(Ganache.provider({}));
    const confirmationCount = 10;
    const appointmentId1 = "id1";
    const appointmentId2 = "id2";
    const errorAppointmentID = "id3";
    const errorRemoveByIdId = "id4";
    const eventFilter = {
        address: "fake address",
        topics: ["topic1", "topic2"]
    };
    const blockNumber = 100;
    const appointment1Expired = blockNumber;
    const appointment2Expired = blockNumber + 1;
    const bothAppointmentsExpired = blockNumber + 2;
    const nothingExpired = blockNumber + 3;
    // an appointment that take 20 ms before returning appointment 1
    const slowExpired = blockNumber + 4;
    const slowExpiredTime = 20;
    const errorStoreExpired = blockNumber + 5;
    const errorSubscriberAppointmentExpired = blockNumber + 6;
    const errorRemoveByIdExpiredBlock = blockNumber + 7;

    // appointment mocks
    const createMockAppointment = (id: string, ethersEventFilter: ethers.EventFilter) => {
        const mockedAppointment = mock(KitsuneAppointment);
        when(mockedAppointment.id).thenReturn(id);
        when(mockedAppointment.getEventFilter()).thenReturn(ethersEventFilter);
        return instance(mockedAppointment);
    };

    const appointmentInstance1 = createMockAppointment(appointmentId1, eventFilter);
    const appointmentInstance2 = createMockAppointment(appointmentId2, eventFilter);
    const errorSubscriberAppointment = createMockAppointment(errorAppointmentID, eventFilter);
    const errorStoreRemoveByIdAppointment = createMockAppointment(errorRemoveByIdId, eventFilter);

    // mock the store
    const mockedStore = mock(MemoryAppointmentStore);
    when(mockedStore.removeById(appointmentInstance1.id)).thenResolve(true);
    when(mockedStore.removeById(appointmentInstance2.id)).thenResolve(true);
    when(mockedStore.removeById(errorStoreRemoveByIdAppointment.id)).thenReject(new Error("Remove failed."));
    when(mockedStore.getExpiredSince(appointment1Expired - confirmationCount)).thenResolve([appointmentInstance1]);

    when(mockedStore.getExpiredSince(appointment2Expired - confirmationCount)).thenResolve([appointmentInstance2]);
    when(mockedStore.getExpiredSince(bothAppointmentsExpired - confirmationCount)).thenResolve([
        appointmentInstance1,
        appointmentInstance2
    ]);
    when(mockedStore.getExpiredSince(nothingExpired - confirmationCount)).thenResolve([]);
    // wait some time, then call then return the appointment
    when(mockedStore.getExpiredSince(slowExpired - confirmationCount)).thenCall(async () => {
        await wait(slowExpiredTime);
        return [appointmentInstance1];
    });
    when(mockedStore.getExpiredSince(errorStoreExpired - confirmationCount)).thenReject(
        new Error("Exceptional expired error.")
    );
    when(mockedStore.getExpiredSince(errorSubscriberAppointmentExpired - confirmationCount)).thenResolve([
        errorSubscriberAppointment
    ]);
    when(mockedStore.getExpiredSince(errorRemoveByIdExpiredBlock - confirmationCount)).thenResolve([
        errorStoreRemoveByIdAppointment
    ]);

    const storeInstance = instance(mockedStore);

    // mock subscriptions
    const mockedAppointmentSubscriber = mock(AppointmentSubscriber);
    when(mockedAppointmentSubscriber.unsubscribe(appointmentId1, eventFilter));
    when(mockedAppointmentSubscriber.unsubscribe(appointmentId1, eventFilter));
    when(mockedAppointmentSubscriber.unsubscribe(errorAppointmentID, eventFilter)).thenThrow(
        new Error("Exception subscriber error.")
    );
    const appointmentSubscriberInstance = instance(mockedAppointmentSubscriber);

    afterEach(() => {
        resetCalls(mockedStore);
        resetCalls(mockedAppointmentSubscriber);
    });

    it("observe succussfully responds and updates store", async () => {
        const gc = new AppointmentStoreGarbageCollector(
            provider,
            confirmationCount,
            storeInstance,
            appointmentSubscriberInstance
        );

        gc.start();

        // trigger the block event
        provider.emit("block", appointment1Expired);

        // allow the event loop to cycle
        await wait(1);

        gc.stop();

        verify(mockedStore.removeById(appointmentId1)).once();
        verify(mockedAppointmentSubscriber.unsubscribe(appointmentId1, eventFilter)).once();
    });

    it("can only be started once", () => {
        const mockedProvider = mock(ethers.providers.Web3Provider);
        when(mockedProvider.on("block", anything()));
        const onProviderInstance = instance(mockedProvider);

        const gc = new AppointmentStoreGarbageCollector(
            onProviderInstance,
            confirmationCount,
            storeInstance,
            appointmentSubscriberInstance
        );

        // call start twice
        gc.start();
        gc.start();
        gc.stop();

        //the block event was only subscribed to once
        verify(mockedProvider.on("block", anything())).once();
    });

    it("can collect two appointments on two events", async () => {
        const gc = new AppointmentStoreGarbageCollector(
            provider,
            confirmationCount,
            storeInstance,
            appointmentSubscriberInstance
        );

        gc.start();
        provider.emit("block", appointment1Expired);
        provider.emit("block", appointment2Expired);
        await wait(1);
        gc.stop();

        verify(mockedStore.removeById(appointmentId1)).once();
        verify(mockedStore.removeById(appointmentId2)).once();
        verify(mockedAppointmentSubscriber.unsubscribe(appointmentId1, eventFilter)).once();
        verify(mockedAppointmentSubscriber.unsubscribe(appointmentId2, eventFilter)).once();
    });

    it("can collect multiple appointments on one event", async () => {
        const gc = new AppointmentStoreGarbageCollector(
            provider,
            confirmationCount,
            storeInstance,
            appointmentSubscriberInstance
        );

        gc.start();
        provider.emit("block", bothAppointmentsExpired);
        await wait(1);
        gc.stop();

        verify(mockedStore.removeById(appointmentId1)).once();
        verify(mockedStore.removeById(appointmentId2)).once();
        verify(mockedAppointmentSubscriber.unsubscribe(appointmentId1, eventFilter)).once();
        verify(mockedAppointmentSubscriber.unsubscribe(appointmentId2, eventFilter)).once();
    });
    it("does nothing when no appointments to collect", async () => {
        const gc = new AppointmentStoreGarbageCollector(
            provider,
            confirmationCount,
            storeInstance,
            appointmentSubscriberInstance
        );

        gc.start();
        provider.emit("block", nothingExpired);
        await wait(1);
        gc.stop();

        verify(mockedStore.removeById(anyString())).never();
        verify(mockedAppointmentSubscriber.unsubscribe(anyString(), anything())).never();
    });
    it("only collects from one of two simultaneous blocks", async () => {
        const gc = new AppointmentStoreGarbageCollector(
            provider,
            confirmationCount,
            storeInstance,
            appointmentSubscriberInstance
        );

        gc.start();
        provider.emit("block", slowExpired);
        // wait for less than the slow expired timeout
        await wait(slowExpiredTime - 10);
        provider.emit("block", appointment2Expired);
        gc.stop();

        // wait for more than the slow expired timeout
        await wait(slowExpiredTime + 10);

        verify(mockedStore.removeById(appointmentId1)).once();
        verify(mockedAppointmentSubscriber.unsubscribe(appointmentId1, eventFilter)).once();
        // the second appointment should not be collected -it would be collected in later runs
        verify(mockedStore.removeById(appointmentId2)).never();
        verify(mockedAppointmentSubscriber.unsubscribe(appointmentId2, eventFilter)).never();
    });
    it("safely catches when subcriber throws error", async () => {
        const gc = new AppointmentStoreGarbageCollector(
            provider,
            confirmationCount,
            storeInstance,
            appointmentSubscriberInstance
        );

        gc.start();
        provider.emit("block", errorSubscriberAppointmentExpired);
        await wait(1);
        gc.stop();
        verify(mockedStore.removeById(errorAppointmentID)).once();
        verify(mockedAppointmentSubscriber.unsubscribe(anything(), eventFilter)).once();
    });
    it("safely catches when store throws error on expired since", async () => {
        const gc = new AppointmentStoreGarbageCollector(
            provider,
            confirmationCount,
            storeInstance,
            appointmentSubscriberInstance
        );

        gc.start();
        provider.emit("block", errorStoreExpired);
        await wait(1);
        gc.stop();
        verify(mockedStore.removeById(anything())).never();
        verify(mockedAppointmentSubscriber.unsubscribe(anything(), eventFilter)).never();
    });
    it("safely catches when store throws error on remove", async () => {
        const gc = new AppointmentStoreGarbageCollector(
            provider,
            confirmationCount,
            storeInstance,
            appointmentSubscriberInstance
        );

        gc.start();
        provider.emit("block", errorRemoveByIdExpiredBlock);
        await wait(1);
        gc.stop();
        verify(mockedStore.removeById(errorRemoveByIdId)).once();
        verify(mockedAppointmentSubscriber.unsubscribe(anything(), eventFilter)).never();
    });

    it("does nothing after being stopped", async () => {
        const gc = new AppointmentStoreGarbageCollector(
            provider,
            confirmationCount,
            storeInstance,
            appointmentSubscriberInstance
        );
        gc.start();
        provider.emit("block", appointment1Expired);
        await wait(1);
        gc.stop();

        provider.emit("block", appointment2Expired);
        await wait(1);

        verify(mockedStore.removeById(appointmentId1)).once();
        verify(mockedAppointmentSubscriber.unsubscribe(appointmentId1, eventFilter)).once();
        verify(mockedStore.removeById(appointmentId2)).never();
        verify(mockedAppointmentSubscriber.unsubscribe(appointmentId2, eventFilter)).never();
    });
});
