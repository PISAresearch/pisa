import "mocha";
import mockito from "ts-mockito";
import uuid from "uuid/v4";
import { EventObserver } from "../../../src/watcher/eventObserver";
import { EthereumResponderManager } from "../../../src/responder";
import { MemoryAppointmentStore } from "../../../src/watcher";
import { KitsuneAppointment } from "../../../src/integrations/kitsune";

describe("EventObserver", () => {
    // abstract mockito mock doesn't seem to work...
    // even though the docs say it should
    const mockedAppointment = mockito.mock(KitsuneAppointment);
    const appointmentId = uuid();

    // mockito would be better if it threw when an unstubbed method was called
    mockito.when(mockedAppointment.formatLog(mockito.anyString())).thenReturn("test log");
    mockito.when(mockedAppointment.id).thenReturn(appointmentId);
    const appointmentInstance = mockito.instance(mockedAppointment);

    const mockedResponder = mockito.mock(EthereumResponderManager);
    mockito.when(mockedResponder.respond(appointmentInstance));
    const responderInstance = mockito.instance(mockedResponder);

    const mockedStore = mockito.mock(MemoryAppointmentStore);
    mockito.when(mockedStore.removeById(appointmentInstance.id)).thenResolve(true);
    const storeInstance = mockito.instance(mockedStore);

    const mockedResponderThatThrows = mockito.mock(EthereumResponderManager);
    mockito.when(mockedResponderThatThrows.respond(appointmentInstance)).thenThrow(new Error("Responder error."));
    const responderInstanceThrow = mockito.instance(mockedResponderThatThrows);

    const mockedStoreThatThrows = mockito.mock(MemoryAppointmentStore);
    mockito.when(mockedStoreThatThrows.removeById(appointmentInstance.id)).thenReject(new Error("Store error."));
    const storeInstanceThrow = mockito.instance(mockedStoreThatThrows);

    afterEach(() => {
        mockito.resetCalls(mockedAppointment)
        mockito.resetCalls(mockedResponder)
        mockito.resetCalls(mockedStore)
        mockito.resetCalls(mockedResponderThatThrows)
        mockito.resetCalls(mockedStoreThatThrows)
    });

    it("observe succussfully responds and updates store", () => {
        const eventObserver = new EventObserver(responderInstance, storeInstance);
        eventObserver.observe(appointmentInstance, []);

        // respond and remove were called in that order
        mockito.verify(mockedResponder.respond(appointmentInstance)).once();
        mockito.verify(mockedStore.removeById(appointmentId)).once();
        mockito
            .verify(mockedResponder.respond(appointmentInstance))
            .calledBefore(mockedStore.removeById(appointmentId));
    });

    it("observe doesnt propogate errors from responder", () => {
        const eventObserver = new EventObserver(responderInstanceThrow, storeInstance);
        eventObserver.observe(appointmentInstance, []);

        // respond and remove were called in that order
        mockito.verify(mockedResponder.respond(appointmentInstance)).never();
        mockito.verify(mockedStore.removeById(appointmentId)).never();
    });

    it("observe doesnt propogate errors from store", () => {
        const eventObserver = new EventObserver(responderInstance, storeInstanceThrow);
        eventObserver.observe(appointmentInstance, []);

        // respond and remove were called in that order
        mockito.verify(mockedResponder.respond(appointmentInstance)).once();
        mockito.verify(mockedStore.removeById(appointmentId)).never();
    });
});
