import "mocha";
import { when, anyString, instance, mock, resetCalls, verify, anything } from "ts-mockito";
import uuid from "uuid/v4";
import { EventObserver } from "../../../src/watcher/eventObserver";
import { EthereumResponderManager } from "../../../src/responder";
import { MemoryAppointmentStore } from "../../../src/watcher";
import { KitsuneAppointment } from "../../../src/integrations/kitsune";

describe("EventObserver", () => {
    // abstract mockito mock doesn't seem to work...
    // even though the docs say it should
    const mockedAppointment = mock(KitsuneAppointment);
    const appointmentId = uuid();

    // mockito would be better if it threw when an unstubbed method was called
    when(mockedAppointment.formatLog(anyString())).thenReturn("test log");
    when(mockedAppointment.id).thenReturn(appointmentId);
    const appointmentInstance = instance(mockedAppointment);

    const mockedResponder = mock(EthereumResponderManager);
    when(mockedResponder.respond(appointmentInstance));
    const responderInstance = instance(mockedResponder);

    const mockedStore = mock(MemoryAppointmentStore);
    when(mockedStore.removeById(appointmentInstance.id)).thenResolve(true);
    const storeInstance = instance(mockedStore);

    const mockedResponderThatThrows = mock(EthereumResponderManager);
    when(mockedResponderThatThrows.respond(appointmentInstance)).thenThrow(new Error("Responder error."));
    const responderInstanceThrow = instance(mockedResponderThatThrows);

    const mockedStoreThatThrows = mock(MemoryAppointmentStore);
    when(mockedStoreThatThrows.removeById(appointmentInstance.id)).thenReject(new Error("Store error."));
    const storeInstanceThrow = instance(mockedStoreThatThrows);

    afterEach(() => {
        resetCalls(mockedAppointment);
        resetCalls(mockedResponder);
        resetCalls(mockedStore);
        resetCalls(mockedResponderThatThrows);
        resetCalls(mockedStoreThatThrows);
    });

    it("observe succussfully responds and updates store", () => {
        const eventObserver = new EventObserver(responderInstance, storeInstance);
        eventObserver.observe(appointmentInstance, []);

        // respond and remove were called in that order
        verify(mockedResponder.respond(appointmentInstance)).once();
        verify(mockedStore.removeById(appointmentId)).once();
        verify(mockedResponder.respond(appointmentInstance)).calledBefore(mockedStore.removeById(appointmentId));
    });

    it("observe doesnt propogate errors from responder", () => {
        const eventObserver = new EventObserver(responderInstanceThrow, storeInstance);
        eventObserver.observe(appointmentInstance, []);

        // respond and remove were called in that order
        verify(mockedResponderThatThrows.respond(appointmentInstance)).once();
        verify(mockedStore.removeById(appointmentId)).never();
    });

    it("observe doesnt propogate errors from store", () => {
        const eventObserver = new EventObserver(responderInstance, storeInstanceThrow);
        eventObserver.observe(appointmentInstance, []);

        // respond and remove were called in that order
        verify(mockedResponder.respond(appointmentInstance)).once();
        verify(mockedStoreThatThrows.removeById(anything())).once();
    });
});
