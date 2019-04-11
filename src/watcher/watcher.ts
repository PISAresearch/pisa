import { IAppointment } from "../dataEntities";
import { ethers } from "ethers";
import logger from "../logger";
import { inspect } from "util";
import { Responder } from "../responder";
import { ConfigurationError } from "../dataEntities/errors";
import { AppointmentSubscriber } from "./appointmentSubscriber";
import { IAppointmentStore } from "./store";
import { AppointmentStoreGarbageCollector } from "./garbageCollector";

/**
 * Watches the chain for events related to the supplied appointments. When an event is noticed data is forwarded to the
 * supplied responder to complete the task. The watcher is not responsible for ensuring that observed events are properly
 * acted upon, that is the responsibility of the responder.
 */
export class Watcher {
    /**
     * Watches the chain for events related to the supplied appointments. When an event is noticed data is forwarded to the
     * supplied responder to complete the task. The watcher is not responsible for ensuring that observed events are properly
     * acted upon, that is the responsibility of the responder.
     * @param provider The provider used to monitor for events
     * @param responder The responder to notify in when an event is observed
     * @param confirmationsCount The number of confirmations to be observed before considering a event final
     * @param store A repository for storing the current appointments being watched for
     */
    public constructor(
        public readonly provider: ethers.providers.Provider,
        public readonly responder: Responder,
        public readonly confirmationsCount: number,
        public store: IAppointmentStore
    ) {
        this.appointmentSubscriber = new AppointmentSubscriber(provider);
        this.zStore = store;
        this.appointmentStoreGarbageCollector = new AppointmentStoreGarbageCollector(
            provider,
            confirmationsCount,
            store,
            this.appointmentSubscriber
        );
        this.appointmentStoreGarbageCollector.start();
    }

    private readonly appointmentSubscriber: AppointmentSubscriber;
    private readonly zStore: IAppointmentStore;
    private readonly appointmentStoreGarbageCollector: AppointmentStoreGarbageCollector;

    // there are three separate processes that can run concurrently as part of the watcher
    // each of them updates the data store.
    // 1) NEW APPOINTMENTS:
    //      New appointments are added or updated in the store keyed by appointment.getStateLocator()
    //        i) If an appointment with that locator exists and has a lower nonce, it is updated to be the new appointment
    //        ii) If an appointment with that locator exits and it has a higher or equal nonce, the new appointment is rejected
    //        iii) If it does not exist, it is added
    //      After the appointment has been added to the store it is then and then subscribed to. We subscribe last 
    //      because if the event to which the appointment is subscribed is fired then that event will try to remove the
    //      appointment and put the add and remove into a race condition. Therefore we wait until we are certain that the
    //      appointment has been added before it can become possible for it to be removed.
    // 2) OBSERVED EVENTS
    //      When subscribed appointments are observed as events they are first pased to the responder. Then they are
    //      removed from the remote store, and finally from the local store. When appointments are removed they are
    //      keyed by appointment id we are sure to try and remove the exact appointment that the listener was subscribed
    //      against. If the appointment was not in the db, since appointments can be removed in any of these 3 processes:
    //      (new appointments, observed events, GC) then this should not be considered an error
    // 3) GARBAGE COLLECTION (GC)
    //      Periodically appointments will be checked to see if they have expired. To make this process easier we could
    //      order the appointments by expiry date, then pop the top appointment and see if it has expired. If it hasn't
    //      then wait until the next poll. If it has then continue popping appointments until the we reach one that has
    //      not expired. Expired appointment should be removed first from the remote store then the local and unsubsribced,
    //      either singularly or batched, but the order here does not matter. Again deletes should by keyed by
    //      appointment id, and it shouldn't matter if an appointment does not exist to be deleted. (Although this
    //      should be unlikely)

    async observeEvent(appointment: IAppointment, ...eventArgs: any[]) {
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

            // pass the appointment to the responder to complete. At this point the job has completed as far as
            // the watcher is concerned, therefore although respond is an async function we do not need to await it for a result
            this.responder.respond(appointment);

            // after firing a response we can remove the local store
            await this.zStore.removeById(appointment.id);
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

    /**
     * Start watch for an event specified by the appointment, and respond if it the event is raised.
     * @param appointment Contains information about where to watch for events, and what information to suppli as part of a response
     */
    async addAppointment(appointment: IAppointment) {
        //PISA: also check rate limiting
        const watchStartTime = Date.now();
        if (!appointment.passedInspection) throw new ConfigurationError(`Inspection not passed.`);
        if (appointment.startTime > watchStartTime || appointment.endTime <= watchStartTime) {
            throw new ConfigurationError(
                `Time now: ${watchStartTime} is not between start time: ${appointment.startTime} and end time ${
                    appointment.endTime
                }.`
            );
        }

        logger.info(appointment.formatLog(`Begin watching for event ${appointment.getEventName()}.`));

        // update this appointment in the store
        await this.zStore.addOrUpdateByStateLocator(appointment);

        // remove the subscription, this is blocking code so we don't have to worry that an event will be observed
        // whilst we remove these listeners and add new ones
        const filter = appointment.getEventFilter();
        this.appointmentSubscriber.unsubscribeAll(filter);

        // subscribe the listener
        const listener = async (...args: any[]) => await this.observeEvent(appointment, args);
        this.appointmentSubscriber.subscribeOnce(appointment.id, filter, listener);
    }
}
