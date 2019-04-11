import { ethers } from "ethers";
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

    subscribe(appointmentId: string, filter: ethers.providers.EventType, listener: ethers.providers.Listener) {
        // 102: reject subscription if it is already subscribed? or throw error for safety?

        // create a listener object with a secret appointment id property for lookup later
        const listenerAndAppointment: IAppointmentListener = Object.assign(listener, {
            appointmentId
        });

        this.provider.once(filter, listenerAndAppointment);
    }

    unsubscribe(appointmentId: string, filter: ethers.providers.EventType) {
        const listeners = this.provider.listeners(filter) as IAppointmentListener[];

        // there should always only be one or appointments for each filter
        // 102: error!??
        // 102: could be 0
        if (listeners.length === 0) return;
        if (listeners.length !== 1) throw new Error("More than one listener.");

        if (listeners[0].appointmentId === appointmentId) {
            // this is the correct appointment - unsubscribe
            this.provider.removeListener(filter, listeners[0]);
        }
        // otherwise this appointment has already been unsubscribed
    }

    unsubscribeAll(filter: ethers.providers.EventType) {
        this.provider.removeAllListeners(filter);
    }
}
