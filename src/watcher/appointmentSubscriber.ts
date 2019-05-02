import { ethers } from "ethers";
import { ApplicationError } from "../dataEntities/errors";

/** A helper interface for the additional markup we require on a listener */
export interface IAppointmentListener {
    (...args: any[]): void;
    appointmentId: string;
}

/**
 * If we wish to unsubscribe an appointment from the provider we have a problem. In the provider
 * appointments are keyed only by their filter, so an appointment could be updated, then another
 * process tries to remove the old appointment and in doing so removes the new one. This class
 * assigns appointment ids to listeners and ensures that appointments are only removed from the
 * provider if the provide appointment id matches.
 */
export class AppointmentSubscriber {
    constructor(private provider: ethers.providers.Provider) {}

    /**
     * Subscribe a listener to an appointment event. Only allows one subscription per filter.
     * @param appointmentId The id of the appointment to which the listener/event correspond
     * @param filter The event to subscribe to
     * @param listener The listener to activate when the event is observed
     * @throws Throws if a listener is already subscribed to this filter.
     */
    public subscribe(
        appointmentId: string,
        filter: ethers.providers.EventType,
        listener: ethers.providers.Listener
    ) {
        // don't allow an appointment to be subscribed twice
        if (this.provider.listenerCount(filter) !== 0) {
            // this is an unexpected error, it could mean that we're subscribing to this filter elsewhere which we want to avoid
            // or it could mean we're trying to subscribe appointments without removing existing ones, which is also a problem
            const currentListener = this.provider.listeners(filter)[0] as IAppointmentListener;
            throw new ApplicationError(
                `Only one appointment should be subscribed to a given filter at any one time. Appointment: ${appointmentId} cannot be subscribed since appointment: ${
                    currentListener.appointmentId
                } is already subscribed.`
            );
        }
        // -- create a listener object with am appointment id property for lookup later --
        // there's a bug in ethersjs that when an event filter is added with a listener
        // that is already on the provider, they are somehow matched internally. The
        // result is that when calling for listeners with the any of the events, the last
        // added event for any of those listeners is returned. Subscribe shouldn't be called
        // with the same listener each time, but to ensure it isn't we clone the listener using
        // bind, then we can safely assign the appointmentId to a guaranteed new object
        const listenerAndAppointment = Object.assign(listener.bind({}), { appointmentId })
        
        this.provider.on(filter, listenerAndAppointment);
    }

    /**
     * Unsubscribe an event with the specified appointment id. Only unsubscribes an appointment if the listener
     * located by the filter has a matching appointment id. Does nothing if this appointment is not currently subscribed.
     * @param appointmentId The id of the appointment to be unsubscribed
     * @param filter The event filter used to locate the relevant listener
     * @throw If there are not zero or one listeners to the supplied filter
     */
    public unsubscribe(appointmentId: string, filter: ethers.providers.EventType) {
        const listeners = this.provider.listeners(filter) as IAppointmentListener[];
        this.checkCurrentlyZeroOrOneListener(filter);
        if (listeners.length === 0) return;

        // therefore there must be one listener
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
    public unsubscribeAll(filter: ethers.providers.EventType) {
        this.checkCurrentlyZeroOrOneListener(filter);
        // for consistency lets check that the correct number of listeners exists
        this.provider.removeAllListeners(filter);
    }

    /**
     * Sanity check that there can only be zero or one listener for a given filter at any one time.
     * @param filter
     * @throws ApplicationError there are not zero or one listeners.
     */
    private checkCurrentlyZeroOrOneListener(filter: ethers.providers.EventType) {
        const listeners = this.provider.listeners(filter) as IAppointmentListener[];

        // there should always only be none or one appointments for each filter
        if (listeners.length > 1) {
            throw new ApplicationError(
                `More than one appointment found to be subscribed to a given filter. Appointments: ${listeners.map(
                    l => l.appointmentId
                )}.`
            );
        }
    }
}
