import { IEthereumAppointment } from "../dataEntities";
import { IAppointmentStore } from "./store";
import logger from "../logger";
import { EthereumResponderManager } from "../responder";
import { inspect } from "util";

/**
 * Observes appointment related events
 */
export class EventObserver {
    constructor(private readonly responder: EthereumResponderManager, private readonly store: IAppointmentStore) {}

    /**
     * Calls the responder and removes the appointment from the store
     * @param appointment 
     * @param eventArgs 
     */
    public async observe(appointment: IEthereumAppointment, eventArgs: any[]) {
        return await this.withLogAndCatch(appointment, eventArgs, async () => {
            // pass the appointment to the responder to complete. At this point the job has completed as far as
            // the watcher is concerned, therefore although respond is an async function we do not need to await it for a result
            this.responder.respond(appointment);

            // after firing a response we can remove the local store
            await this.store.removeById(appointment.id);
        });
    }

    /** A helper method for wrapping a block in a catch, and logging relevant info */
    private async withLogAndCatch(
        appointment: IEthereumAppointment,
        eventArgs: any[],
        observeEvent: (appointment: IEthereumAppointment, eventArgs: any[]) => Promise<void>
    ) {
        // this callback should not throw exceptions as they cannot be handled elsewhere
        try {
            logger.info(
                appointment.formatLog(
                    `Observed event ${appointment.getEventName()} in contract ${appointment.getContractAddress()} with arguments : ${eventArgs.slice(
                        0,
                        eventArgs.length - 1
                    )}.`
                )
            );
            logger.debug(`Event info: ${inspect(eventArgs)}`);

            await observeEvent(appointment, eventArgs);
        } catch (doh) {
            // an error occured whilst responding to the callback - this is serious and the problem needs to be correctly diagnosed
            logger.error(
                appointment.formatLog(
                    `An unexpected errror occured whilst responding to event ${appointment.getEventName()} in contract ${appointment.getContractAddress()}.`
                )
            );
            logger.error(appointment.formatLog(doh));
        }
    }
}
