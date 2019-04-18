import "mocha";
import { assert } from "chai";
import mockito, { mock, instance, when, verify, anything, resetCalls } from "ts-mockito";
import uuid from "uuid/v4";
import { EventObserver } from "../../../src/watcher/eventObserver";
import { MemoryAppointmentStore, Watcher } from "../../../src/watcher";
import { KitsuneAppointment } from "../../../src/integrations/kitsune";
import { ethers } from "ethers";
import { AppointmentSubscriber } from "../../../src/watcher/appointmentSubscriber";

describe("Watcher", () => {
    // appointment mocks
    const appointmentId1 = uuid();
    const appointmentId2 = uuid();
    const appointmentErrorUpdateStateId = uuid();
    const appointmentErrorUnsubscribeId = uuid();
    const appointmentErrorSubscribeOnceId = uuid();
    const eventFilter = {
        address: "fake address",
        topics: ["topic1", "topic2"]
    };
    const errorEventFilter = {
        address: "error address",
        topics: ["topic1", "topic2"]
    };
    const createMockAppointment = (id: string, ethersEventFilter: ethers.EventFilter, passedInspection: boolean) => {
        const mockedAppointment = mockito.mock(KitsuneAppointment);
        mockito.when(mockedAppointment.id).thenReturn(id);
        mockito.when(mockedAppointment.getEventFilter()).thenReturn(ethersEventFilter);
        mockito.when(mockedAppointment.passedInspection).thenReturn(passedInspection);
        return mockito.instance(mockedAppointment);
    };
    const appointmentCanBeUpdated = createMockAppointment(appointmentId1, eventFilter, true);
    const appointmentNotUpdated = createMockAppointment(appointmentId2, eventFilter, true);
    const appointmentNotInspected = createMockAppointment(appointmentId1, eventFilter, false);
    const appointmentErrorUpdate = createMockAppointment(appointmentErrorUpdateStateId, eventFilter, true);
    const appointmentErrorUnsubscribe = createMockAppointment(appointmentErrorUnsubscribeId, errorEventFilter, true);
    const appointmentErrorSubscribeOnce = createMockAppointment(appointmentErrorSubscribeOnceId, eventFilter, true);

    // observer mock
    const mockedObserver = mock(EventObserver);
    const observer = instance(mockedObserver);

    // appointment subscriber mock
    const mockedAppointmentSubscriber = mock(AppointmentSubscriber);
    when(mockedAppointmentSubscriber.subscribeOnce(appointmentId1, eventFilter, anything()));
    when(mockedAppointmentSubscriber.unsubscribeAll(eventFilter));
    when(
        mockedAppointmentSubscriber.subscribeOnce(
            appointmentErrorSubscribeOnce.id,
            appointmentErrorSubscribeOnce.getEventFilter(),
            anything()
        )
    ).thenThrow(new Error("Subscribe once error."));
    when(mockedAppointmentSubscriber.unsubscribeAll(appointmentErrorUnsubscribe.getEventFilter())).thenThrow(
        new Error("Unsubscribe error.")
    );
    const appointmentSubscriber = instance(mockedAppointmentSubscriber);

    // store mock
    const mockedStore = mock(MemoryAppointmentStore);
    when(mockedStore.addOrUpdateByStateLocator(appointmentCanBeUpdated)).thenResolve(true);
    when(mockedStore.addOrUpdateByStateLocator(appointmentNotUpdated)).thenResolve(false);
    when(mockedStore.addOrUpdateByStateLocator(appointmentErrorSubscribeOnce)).thenResolve(true);
    when(mockedStore.addOrUpdateByStateLocator(appointmentErrorUnsubscribe)).thenResolve(true);
    when(mockedStore.addOrUpdateByStateLocator(appointmentErrorUpdate)).thenReject(new Error("Store update failure."));
    const store = instance(mockedStore);

    afterEach(() => {
        resetCalls(mockedStore);
        resetCalls(mockedAppointmentSubscriber);
        resetCalls(mockedObserver);
    });

    it("add appointment updates store and subscriptions", async () => {
        const watcher = new Watcher(observer, appointmentSubscriber, store);

        assert.strictEqual(await watcher.addAppointment(appointmentCanBeUpdated), true);

        verify(mockedStore.addOrUpdateByStateLocator(appointmentCanBeUpdated)).once();
        verify(mockedAppointmentSubscriber.unsubscribeAll(appointmentCanBeUpdated.getEventFilter())).once();
        verify(
            mockedAppointmentSubscriber.subscribeOnce(
                appointmentCanBeUpdated.id,
                appointmentCanBeUpdated.getEventFilter(),
                anything()
            )
        ).once();
    });

    it("add appointment without update does not update subscriptions and returns false", async () => {
        const watcher = new Watcher(observer, appointmentSubscriber, store);

        assert.strictEqual(await watcher.addAppointment(appointmentNotUpdated), false);

        verify(mockedStore.addOrUpdateByStateLocator(appointmentNotUpdated)).once();
        verify(mockedAppointmentSubscriber.unsubscribeAll(appointmentNotUpdated.getEventFilter())).never();
        verify(
            mockedAppointmentSubscriber.subscribeOnce(
                appointmentNotUpdated.id,
                appointmentNotUpdated.getEventFilter(),
                anything()
            )
        ).never();
    });
    it("add appointment not passed inspection throws error", async () => {
        const watcher = new Watcher(observer, appointmentSubscriber, store);

        try {
            await watcher.addAppointment(appointmentNotInspected);
            assert(false);
        } catch (doh) {
            verify(mockedStore.addOrUpdateByStateLocator(appointmentNotInspected)).never();
            verify(mockedAppointmentSubscriber.unsubscribeAll(appointmentNotInspected.getEventFilter())).never();
            verify(
                mockedAppointmentSubscriber.subscribeOnce(
                    appointmentNotInspected.id,
                    appointmentNotInspected.getEventFilter(),
                    anything()
                )
            ).never();
        }
    });
    it("add appointment throws error when update store throws error", async () => {
        const watcher = new Watcher(observer, appointmentSubscriber, store);

        try {
            await watcher.addAppointment(appointmentErrorUpdate);
            assert(false);
        } catch (doh) {
            verify(mockedStore.addOrUpdateByStateLocator(appointmentErrorUpdate)).once();
            verify(mockedAppointmentSubscriber.unsubscribeAll(appointmentErrorUpdate.getEventFilter())).never();
            verify(
                mockedAppointmentSubscriber.subscribeOnce(
                    appointmentErrorUpdate.id,
                    appointmentErrorUpdate.getEventFilter(),
                    anything()
                )
            ).never();
        }
    });
    it("add appointment throws error when subscribe unsubscribeall throws error", async () => {
        const watcher = new Watcher(observer, appointmentSubscriber, store);

        try {
            await watcher.addAppointment(appointmentErrorUnsubscribe);
            assert(false);
        } catch (doh) {
            verify(mockedStore.addOrUpdateByStateLocator(appointmentErrorUnsubscribe)).once();
            verify(mockedAppointmentSubscriber.unsubscribeAll(appointmentErrorUnsubscribe.getEventFilter())).once();
            verify(
                mockedAppointmentSubscriber.subscribeOnce(
                    appointmentErrorUnsubscribe.id,
                    appointmentErrorUnsubscribe.getEventFilter(),
                    anything()
                )
            ).never();
        }
    });
    it("add appointment throws error when subscriber once throw error", async () => {
        const watcher = new Watcher(observer, appointmentSubscriber, store);

        try {
            await watcher.addAppointment(appointmentErrorSubscribeOnce);
            assert(false);
        } catch (doh) {
            verify(mockedStore.addOrUpdateByStateLocator(appointmentErrorSubscribeOnce)).once();
            verify(mockedAppointmentSubscriber.unsubscribeAll(appointmentErrorSubscribeOnce.getEventFilter())).once();
            verify(
                mockedAppointmentSubscriber.subscribeOnce(
                    appointmentErrorSubscribeOnce.id,
                    appointmentErrorSubscribeOnce.getEventFilter(),
                    anything()
                )
            ).once();
        }
    });
});
