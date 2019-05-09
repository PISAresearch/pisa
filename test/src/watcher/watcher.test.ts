import "mocha";
import { assert } from "chai";
import mockito, { mock, instance, when, verify, anything, resetCalls, capture, anyNumber } from "ts-mockito";
import uuid from "uuid/v4";
import { AppointmentStore, Watcher } from "../../../src/watcher";
import { KitsuneAppointment } from "../../../src/integrations/kitsune";
import { ethers } from "ethers";
import { AppointmentSubscriber } from "../../../src/watcher/appointmentSubscriber";
import * as Ganache from "ganache-core";
import { EthereumResponderManager } from "../../../src/responder";
import { ReorgDetector } from "../../../src/blockMonitor";

describe("Watcher", () => {
    const ganache = Ganache.provider({});
    const provider = new ethers.providers.Web3Provider(ganache);

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

    // appointment subscriber mock
    const mockedAppointmentSubscriber = mock(AppointmentSubscriber);
    when(mockedAppointmentSubscriber.subscribe(appointmentId1, eventFilter, anything()));
    when(mockedAppointmentSubscriber.unsubscribeAll(eventFilter));
    when(
        mockedAppointmentSubscriber.subscribe(
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
    const mockedStore = mock(AppointmentStore);
    when(mockedStore.addOrUpdateByStateLocator(appointmentCanBeUpdated)).thenResolve(true);
    when(mockedStore.addOrUpdateByStateLocator(appointmentNotUpdated)).thenResolve(false);
    when(mockedStore.addOrUpdateByStateLocator(appointmentErrorSubscribeOnce)).thenResolve(true);
    when(mockedStore.addOrUpdateByStateLocator(appointmentErrorUnsubscribe)).thenResolve(true);
    when(mockedStore.addOrUpdateByStateLocator(appointmentErrorUpdate)).thenReject(new Error("Store update failure."));
    const store = instance(mockedStore);

    const mockedResponder = mock(EthereumResponderManager);
    when(mockedResponder.respond(appointmentCanBeUpdated));
    const responderInstance = instance(mockedResponder);

    const mockedResponderThatThrows = mock(EthereumResponderManager);
    when(mockedResponderThatThrows.respond(appointmentCanBeUpdated)).thenThrow(new Error("Responder error."));
    const responderInstanceThrow = instance(mockedResponderThatThrows);

    const mockedStoreThatThrows = mock(AppointmentStore);
    when(mockedStoreThatThrows.removeById(appointmentCanBeUpdated.id)).thenReject(new Error("Store error."));
    const storeInstanceThrow = instance(mockedStoreThatThrows);

    const mockedReorgDetector = mock(ReorgDetector);
    when(mockedReorgDetector.addReorgHeightListener(anyNumber(), anything())).thenReturn();
    const reorgDetectorInstance = instance(mockedReorgDetector);

    const event = {
        blockNumber: 10
    } as ethers.Event;

    afterEach(() => {
        resetCalls(mockedStore);
        resetCalls(mockedAppointmentSubscriber);
        resetCalls(mockedResponder);
        resetCalls(mockedStore);
        resetCalls(mockedResponderThatThrows);
        resetCalls(mockedStoreThatThrows);
        resetCalls(mockedReorgDetector);
    });

    it("add appointment updates store and subscriptions", async () => {
        const watcher = new Watcher(provider, responderInstance, reorgDetectorInstance, appointmentSubscriber, store);

        assert.strictEqual(await watcher.addAppointment(appointmentCanBeUpdated), true);

        verify(mockedStore.addOrUpdateByStateLocator(appointmentCanBeUpdated)).once();
        verify(mockedAppointmentSubscriber.unsubscribeAll(appointmentCanBeUpdated.getEventFilter())).once();
        verify(
            mockedAppointmentSubscriber.subscribe(
                appointmentCanBeUpdated.id,
                appointmentCanBeUpdated.getEventFilter(),
                anything()
            )
        ).once();
    });

    it("add appointment without update does not update subscriptions and returns false", async () => {
        const watcher = new Watcher(provider, responderInstance, reorgDetectorInstance, appointmentSubscriber, store);

        assert.strictEqual(await watcher.addAppointment(appointmentNotUpdated), false);

        verify(mockedStore.addOrUpdateByStateLocator(appointmentNotUpdated)).once();
        verify(mockedAppointmentSubscriber.unsubscribeAll(appointmentNotUpdated.getEventFilter())).never();
        verify(
            mockedAppointmentSubscriber.subscribe(
                appointmentNotUpdated.id,
                appointmentNotUpdated.getEventFilter(),
                anything()
            )
        ).never();
    });
    it("add appointment not passed inspection throws error", async () => {
        const watcher = new Watcher(provider, responderInstance, reorgDetectorInstance, appointmentSubscriber, store);

        try {
            await watcher.addAppointment(appointmentNotInspected);
            assert(false);
        } catch (doh) {
            verify(mockedStore.addOrUpdateByStateLocator(appointmentNotInspected)).never();
            verify(mockedAppointmentSubscriber.unsubscribeAll(appointmentNotInspected.getEventFilter())).never();
            verify(
                mockedAppointmentSubscriber.subscribe(
                    appointmentNotInspected.id,
                    appointmentNotInspected.getEventFilter(),
                    anything()
                )
            ).never();
        }
    });
    it("add appointment throws error when update store throws error", async () => {
        const watcher = new Watcher(provider, responderInstance, reorgDetectorInstance, appointmentSubscriber, store);

        try {
            await watcher.addAppointment(appointmentErrorUpdate);
            assert(false);
        } catch (doh) {
            verify(mockedStore.addOrUpdateByStateLocator(appointmentErrorUpdate)).once();
            verify(mockedAppointmentSubscriber.unsubscribeAll(appointmentErrorUpdate.getEventFilter())).never();
            verify(
                mockedAppointmentSubscriber.subscribe(
                    appointmentErrorUpdate.id,
                    appointmentErrorUpdate.getEventFilter(),
                    anything()
                )
            ).never();
        }
    });
    it("add appointment throws error when subscribe unsubscribeall throws error", async () => {
        const watcher = new Watcher(provider, responderInstance, reorgDetectorInstance, appointmentSubscriber, store);

        try {
            await watcher.addAppointment(appointmentErrorUnsubscribe);
            assert(false);
        } catch (doh) {
            verify(mockedStore.addOrUpdateByStateLocator(appointmentErrorUnsubscribe)).once();
            verify(mockedAppointmentSubscriber.unsubscribeAll(appointmentErrorUnsubscribe.getEventFilter())).once();
            verify(
                mockedAppointmentSubscriber.subscribe(
                    appointmentErrorUnsubscribe.id,
                    appointmentErrorUnsubscribe.getEventFilter(),
                    anything()
                )
            ).never();
        }
    });
    it("add appointment throws error when subscriber once throw error", async () => {
        const watcher = new Watcher(provider, responderInstance, reorgDetectorInstance, appointmentSubscriber, store);

        try {
            await watcher.addAppointment(appointmentErrorSubscribeOnce);
            assert(false);
        } catch (doh) {
            verify(mockedStore.addOrUpdateByStateLocator(appointmentErrorSubscribeOnce)).once();
            verify(mockedAppointmentSubscriber.unsubscribeAll(appointmentErrorSubscribeOnce.getEventFilter())).once();
            verify(
                mockedAppointmentSubscriber.subscribe(
                    appointmentErrorSubscribeOnce.id,
                    appointmentErrorSubscribeOnce.getEventFilter(),
                    anything()
                )
            ).once();
        }
    });

    it("observe succussfully responds and updates store", () => {
        const watcher = new Watcher(provider, responderInstance, reorgDetectorInstance, appointmentSubscriber, store);

        watcher.observe(appointmentCanBeUpdated, event);

        // respond, reorg and remove were called in that order
        verify(mockedResponder.respond(appointmentCanBeUpdated)).once();
        verify(mockedStore.removeById(appointmentCanBeUpdated.id)).once();
        verify(mockedReorgDetector.addReorgHeightListener(anyNumber(), anything())).once();
        verify(mockedResponder.respond(appointmentCanBeUpdated)).calledBefore(
            mockedStore.removeById(appointmentCanBeUpdated.id)
        );
        verify(mockedReorgDetector.addReorgHeightListener(anyNumber(), anything())).calledBefore(
            mockedStore.removeById(appointmentCanBeUpdated.id)
        );
        verify(mockedAppointmentSubscriber.unsubscribe(appointmentCanBeUpdated.id, anything())).once();
        verify(mockedAppointmentSubscriber.unsubscribe(appointmentCanBeUpdated.id, anything())).calledBefore(
            mockedStore.removeById(appointmentCanBeUpdated.id)
        );
        const [firstArg, _] = capture(mockedReorgDetector.addReorgHeightListener).last();
        assert.strictEqual(firstArg, event.blockNumber, "Event block height incorrect.");
    });

    it("observe doesnt propogate errors from responder", () => {
        const watcher = new Watcher(
            provider,
            responderInstanceThrow,
            reorgDetectorInstance,
            appointmentSubscriber,
            store
        );
        watcher.observe(appointmentCanBeUpdated, event);

        verify(mockedResponderThatThrows.respond(appointmentCanBeUpdated)).once();
        verify(mockedStore.removeById(appointmentCanBeUpdated.id)).never();
        verify(mockedAppointmentSubscriber.unsubscribe(appointmentCanBeUpdated.id, anything())).never();
        verify(mockedReorgDetector.addReorgHeightListener(anyNumber(), anything())).never();
    });

    it("observe doesnt propogate errors from store", () => {
        const watcher = new Watcher(
            provider,
            responderInstance,
            reorgDetectorInstance,
            appointmentSubscriber,
            storeInstanceThrow
        );
        watcher.observe(appointmentCanBeUpdated, event);

        verify(mockedResponder.respond(appointmentCanBeUpdated)).once();
        verify(mockedReorgDetector.addReorgHeightListener(anyNumber(), anything())).once();
        verify(mockedAppointmentSubscriber.unsubscribe(appointmentCanBeUpdated.id, anything())).once();
        verify(mockedStoreThatThrows.removeById(anything())).once();
    });

    it("observe does nothing during a reorg");
});
