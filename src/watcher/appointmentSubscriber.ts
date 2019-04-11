import { ethers } from "ethers";
import { ApplicationError } from "../dataEntities/errors";

/** A helper interface for the additional markup we require on a listener */
interface IAppointmentListener {
    (...args: any[]): void;
    appointmentId: string;
}

/**
 * If we wish to unsubscribe an appointment from the provider we have a problem. In the provider
 * appointments are keyed only by their filter, so an appointment could be updated, then another
 * process tries to remove the old appointment and in doing so removes the new one. This class
 * assigns appointment ids to listeners and ensures that appointments are only removed from the
 * provided if the provide appointment id matches.
 */
export class AppointmentSubscriber {
    constructor(private readonly provider: ethers.providers.Provider) {}

    /**
     * Subscribe a listener to an appointment event. Only allows one subscription per filter.
     * @param appointmentId The id of the appointment to which the listener/event correspond
     * @param filter The event to subscribe to
     * @param listener The listener to activate when the event is observed
     * @throws Throws if a listener is already subscribed to this filter.
     */
    subscribeOnce(appointmentId: string, filter: ethers.providers.EventType, listener: ethers.providers.Listener) {
        // don't allow an appointment to be subscribed twice
        if (this.provider.listenerCount(filter) !== 0) {
            // this is an unexpected error, it could mean that we're subscribing to this filter elsewhere which we want to avoid
            // or it could mean we're trying to subscribe appointments without removing existing ones, which is also a problem
            const listener = this.provider.listeners(filter)[0] as IAppointmentListener;
            throw new ApplicationError(
                `Only one appointment should be subscribed to a given filter at any one time. Appointment: ${appointmentId} cannot be subscribed since appointment: ${
                    listener.appointmentId
                } is already subscribed.`
            );
        }

        // create a listener object with am appointment id property for lookup later
        const listenerAndAppointment: IAppointmentListener = Object.assign(listener, {
            appointmentId
        });

        this.provider.once(filter, listenerAndAppointment);
    }

    /**
     * Unsubscribe an event with the specified appointment id. Only unsubscribes an appointment if the listener
     * located by the filter has a matching appointment id. Does nothing if this appointment is not currently subscribed.
     * @param appointmentId The id of the appointment to be unsubscribed
     * @param filter The event filter used to locate the relevant listener
     * @throw If there are not zero or one listeners to the supplied filter
     */
    unsubscribe(appointmentId: string, filter: ethers.providers.EventType) {
        const listeners = this.provider.listeners(filter) as IAppointmentListener[];
        this.checkCurrentlyZeroOrOneListener(filter)

        if (listeners[0].appointmentId === appointmentId) {
            // this is the correct appointment - unsubscribe
            this.provider.removeListener(filter, listeners[0]);
        }
        // otherwise this appointment has already been unsubscribed previously
    }

    /**
     * Unsubscribe all events that match this event filter, no matter their appointment id.
     * @param filter The event filter used to locate the listeners
     * @throw If there are not zero or one listeners to the supplied filter
     */
    unsubscribeAll(filter: ethers.providers.EventType) {
        this.checkCurrentlyZeroOrOneListener(filter);
        // for consistency lets check that the correct number of listeners exists
        this.provider.removeAllListeners(filter);
    }

    /**
     * Sanity check that there can only be zero or one listener for a given filter at any one time.
     * @param filter 
     */
    checkCurrentlyZeroOrOneListener(filter: ethers.providers.EventType) {
        const listeners = this.provider.listeners(filter) as IAppointmentListener[];

        // there should always only be none or one appointments for each filter
        if (listeners.length === 0) return;
        if (listeners.length !== 1) {
            throw new ApplicationError(
                `More than one appointment found to be subscribed to a given filter. Appointments: ${listeners.map(
                    l => l.appointmentId
                )}.`
            );
        }
    }
}
