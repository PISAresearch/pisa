import "mocha";
import { assert } from "chai";
import mockito, { mock, instance, when, verify, anything, resetCalls, capture, anyNumber, spy } from "ts-mockito";
import uuid from "uuid/v4";
import { AppointmentStore, Watcher } from "../../../src/watcher";
import { KitsuneAppointment } from "../../../src/integrations/kitsune";
import { ethers } from "ethers";
import { AppointmentSubscriber } from "../../../src/watcher/appointmentSubscriber";
import * as Ganache from "ganache-core";
import { EthereumResponderManager } from "../../../src/responder";
import { BlockProcessor, BlockCache, blockStubAndTxFactory } from "../../../src/blockMonitor";
import { IBlockStub, TransactionHashes } from "../../../src/dataEntities";

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

    // BlockProcessor mock
    const mockedBlockProcessor = mock(BlockProcessor);
    const blockProcessor = instance(mockedBlockProcessor);

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
    when(mockedStoreThatThrows.getAll()).thenReturn([appointmentCanBeUpdated, appointmentNotUpdated]);
    const storeInstanceThrow = instance(mockedStoreThatThrows);

    const event = {
        blockNumber: 10
    } as ethers.Event;

    afterEach(() => {
        resetCalls(mockedStore);
        resetCalls(mockedResponder);
        resetCalls(mockedStore);
        resetCalls(mockedResponderThatThrows);
        resetCalls(mockedStoreThatThrows);
    });

    it("add appointment updates store and subscriptions", async () => {
        const watcher = new Watcher(responderInstance, blockProcessor, store, 0);

        assert.strictEqual(await watcher.addAppointment(appointmentCanBeUpdated), true);

        verify(mockedStore.addOrUpdateByStateLocator(appointmentCanBeUpdated)).once();
    });

    it("add appointment without update does not update subscriptions and returns false", async () => {
        const watcher = new Watcher(responderInstance, blockProcessor, store, 0);

        assert.strictEqual(await watcher.addAppointment(appointmentNotUpdated), false);

        verify(mockedStore.addOrUpdateByStateLocator(appointmentNotUpdated)).once();
    });
    it("add appointment not passed inspection throws error", async () => {
        const watcher = new Watcher(responderInstance, blockProcessor, store, 0);

        try {
            await watcher.addAppointment(appointmentNotInspected);
            assert(false);
        } catch (doh) {
            verify(mockedStore.addOrUpdateByStateLocator(appointmentNotInspected)).never();
        }
    });
    it("add appointment throws error when update store throws error", async () => {
        const watcher = new Watcher(responderInstance, blockProcessor, store, 0);

        try {
            await watcher.addAppointment(appointmentErrorUpdate);
            assert(false);
        } catch (doh) {
            verify(mockedStore.addOrUpdateByStateLocator(appointmentErrorUpdate)).once();
        }
    });
    it("add appointment throws error when subscribe unsubscribeall throws error", async () => {
        const watcher = new Watcher(responderInstance, blockProcessor, store, 0);

        try {
            await watcher.addAppointment(appointmentErrorUnsubscribe);
            assert(false);
        } catch (doh) {
            verify(mockedStore.addOrUpdateByStateLocator(appointmentErrorUnsubscribe)).once();
        }
    });
    it("add appointment throws error when subscriber once throw error", async () => {
        const watcher = new Watcher(responderInstance, blockProcessor, store, 0);

        try {
            await watcher.addAppointment(appointmentErrorSubscribeOnce);
            assert(false);
        } catch (doh) {
            verify(mockedStore.addOrUpdateByStateLocator(appointmentErrorSubscribeOnce)).once();
        }
    });

    // it("observe successfully responds and updates store", async () => {
    //     const watcher = new Watcher(responderInstance, blockProcessor, store, 0);

    //     await watcher.observe(appointmentCanBeUpdated, event);

    //     // respond, reorg and remove were called in that order
    //     verify(mockedResponder.respond(appointmentCanBeUpdated)).once();
    //     verify(mockedStore.removeById(appointmentCanBeUpdated.id)).once();
    //     verify(mockedReorgEmitter.addReorgHeightListener(anyNumber(), anything())).once();
    //     verify(mockedResponder.respond(appointmentCanBeUpdated)).calledBefore(
    //         mockedStore.removeById(appointmentCanBeUpdated.id)
    //     );
    //     verify(mockedReorgEmitter.addReorgHeightListener(anyNumber(), anything())).calledBefore(
    //         mockedStore.removeById(appointmentCanBeUpdated.id)
    //     );
    //     verify(mockedAppointmentSubscriber.unsubscribe(appointmentCanBeUpdated.id, anything())).once();
    //     verify(mockedAppointmentSubscriber.unsubscribe(appointmentCanBeUpdated.id, anything())).calledBefore(
    //         mockedStore.removeById(appointmentCanBeUpdated.id)
    //     );
    //     const [firstArg, _] = capture(mockedReorgEmitter.addReorgHeightListener).last();
    //     assert.strictEqual(firstArg, event.blockNumber, "Event block height incorrect.");
    // });

    // it("observe doesnt propagate errors from responder", async () => {
    //     const watcher = new Watcher(responderInstanceThrow, reorgEmitterInstance, appointmentSubscriber, store);
    //     await watcher.observe(appointmentCanBeUpdated, event);

    //     verify(mockedResponderThatThrows.respond(appointmentCanBeUpdated)).once();
    //     verify(mockedStore.removeById(appointmentCanBeUpdated.id)).never();
    //     verify(mockedAppointmentSubscriber.unsubscribe(appointmentCanBeUpdated.id, anything())).never();
    //     verify(mockedReorgEmitter.addReorgHeightListener(anyNumber(), anything())).never();
    // });

    // it("observe doesnt propagate errors from store", async () => {
    //     const watcher = new Watcher(responderInstance, reorgEmitterInstance, appointmentSubscriber, storeInstanceThrow);
    //     await watcher.observe(appointmentCanBeUpdated, event);

    //     verify(mockedResponder.respond(appointmentCanBeUpdated)).once();
    //     verify(mockedReorgEmitter.addReorgHeightListener(anyNumber(), anything())).once();
    //     verify(mockedAppointmentSubscriber.unsubscribe(appointmentCanBeUpdated.id, anything())).once();
    //     verify(mockedStoreThatThrows.removeById(anything())).once();
    // });

    // it("observe does nothing during a reorg", async () => {
    //     const blockCache = new BlockCache<IBlockStub & TransactionHashes>(200);
    //     const blockProcessor = new BlockProcessor<IBlockStub & TransactionHashes>(
    //         provider,
    //         blockStubAndTxFactory,
    //         blockCache
    //     );
    //     const reorgDetect = new ReorgEmitter(provider, blockProcessor, new ReorgHeightListenerStore());
    //     const spiedReorgDetect = spy(reorgDetect);
    //     const watcher = new Watcher(responderInstance, reorgDetect, appointmentSubscriber, storeInstanceThrow);
    //     await watcher.start();

    //     reorgDetect.emit(ReorgEmitter.REORG_START_EVENT);
    //     await watcher.observe(appointmentCanBeUpdated, event);
    //     reorgDetect.emit(ReorgEmitter.REORG_END_EVENT);

    //     verify(mockedResponder.respond(appointmentCanBeUpdated)).never();
    //     verify(spiedReorgDetect.addReorgHeightListener(anyNumber(), anything())).never();
    //     verify(mockedAppointmentSubscriber.unsubscribe(appointmentCanBeUpdated.id, anything())).never();
    //     verify(mockedStoreThatThrows.removeById(anything())).never();

    //     await watcher.observe(appointmentCanBeUpdated, event);

    //     verify(mockedResponder.respond(appointmentCanBeUpdated)).once();
    //     verify(spiedReorgDetect.addReorgHeightListener(anyNumber(), anything())).once();
    //     verify(mockedAppointmentSubscriber.unsubscribe(appointmentCanBeUpdated.id, anything())).once();
    //     verify(mockedStoreThatThrows.removeById(anything())).once();

    //     await watcher.stop();
    // });

    // it("start correctly adds existing appointments to subscriber", async () => {
    //     const watcher = new Watcher(responderInstance, blockProcessor, storeInstanceThrow, 0);
    //     await watcher.start();

    //     storeInstanceThrow.getAll()

    //     verify(
    //         mockedAppointmentSubscriber.subscribe(
    //             appointmentCanBeUpdated.id,
    //             appointmentCanBeUpdated.getEventFilter(),
    //             anything()
    //         )
    //     ).once();
    //     verify(
    //         mockedAppointmentSubscriber.subscribe(
    //             appointmentNotUpdated.id,
    //             appointmentCanBeUpdated.getEventFilter(),
    //             anything()
    //         )
    //     ).once();
    //     await watcher.stop();
    // });
});
