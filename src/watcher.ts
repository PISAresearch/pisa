import { IAppointment } from "./dataEntities/appointment";
import { ethers } from "ethers";
import logger from "./logger";
import { inspect } from "util";
import { Responder } from "./responder";
import { PublicInspectionError, ConfigurationError } from "./dataEntities/errors";

/**
 * Watches the chain for events related to the supplied appointments. When an event is noticed data is forwarded to the
 * supplied responder to complete the task. The watcher is not responsible for ensuring that observed events are properly
 * acted upon, that is the responsibility of the responder.
 */
export class Watcher {
    public constructor(
        public readonly provider: ethers.providers.Provider,
        public readonly responder: Responder,
        public readonly finalityDepth: number
    ) {
        this.appointmentSubscriber = new AppointmentSubscriber(provider);
        this.zStore = new WatchedAppointmentStore();
        this.appointmentStoreGarbageCollector = new AppointmentStoreGarbageCollector(
            finalityDepth,
            provider,
            this.zStore,
            1000,
            this.appointmentSubscriber
        );
    }

    private readonly appointmentSubscriber: AppointmentSubscriber;
    private readonly zStore: WatchedAppointmentStore;
    private readonly appointmentStoreGarbageCollector: AppointmentStoreGarbageCollector;

    // there are three separate processes that can run concurrently as part of the watcher
    // each of them updates the data store
    // 1) new appointments:
    //      New appointments are added or updated in the remote permanent store keyed by appointment.getStateLocator()
    //        i) If an appointment with that locator exists and has a lower nonce, it is updated to be the new appointment
    //        ii) If an appointment with that locator exits and it has a higher or equal nonce, the new appointment is rejected
    //        iii) If it does not exist, it is added
    //      After the appointment has been added the remote permanent store it is then added to the local store,
    //      and then subscribed to. We subscribe last because a subscribed appointment can also update the remote store
    //      and we dont want this to happen until after it has been added as a new appointment.
    // 2) observed events
    //      When subscribed appointments are observed as events they are first pased to the responder. Then they are
    //      removed from the remote store, and finally from the local store. When appointments are removed they are
    //      keyed by appointment id we are sure to try and remove the exact appointment that the listener was subscribed
    //      against. If the appointment was not in the db, since appointments can be removed in any of these 3 processes:
    //      (new appointments, observed events, GC) then this should not be considered an error
    // 3) garbage collection (GC)
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
            await this.zStore.remove(appointment.id);
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
        await this.zStore.addOrUpdate(appointment);

        // remove the subscription, this is blocking code so we don't have to worry that an event will be observed
        // whilst we remove these listeneres and add new ones
        const filter = appointment.getEventFilter();
        this.appointmentSubscriber.unsubscribeAll(filter);

        // subscribe the listener
        const listener = async (...args: any[]) => await this.observeEvent(appointment, args);
        this.appointmentSubscriber.subscribe(appointment.id, filter, listener);
    }
}

/**
 * If we wish to unsubscribe an appointment from the provider we have a problem. In the provider
 * appointments are keyed only by their filter, so an appointment could be updated, then another
 * process tries to remove the old appointment and in doing so removes the new one. This class
 * assigns appointment ids to listeners and ensures that appointments are only removed from the
 * provided if the provide appointment id matches.
 */
class AppointmentSubscriber {
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

        // there should always only be one appointment for each filter
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

interface IAppointmentListener {
    (...args: any[]): void;
    appointmentId: string;
}

class AppointmentStoreGarbageCollector {
    constructor(
        private readonly finalityDepth: number,
        private readonly provider: ethers.providers.Provider,
        private readonly store: WatchedAppointmentStore,
        private readonly pollInterval: number,
        private readonly appointmentSubscriber: AppointmentSubscriber
    ) {
        this.poll();
    }

    private wait(timeMs: number) {
        return new Promise(resolve => {
            setTimeout(resolve, timeMs);
        });
    }

    async poll() {
        try {
            await this.removeExpired();
        } catch (doh) {
            // 102: stop polling? yes,no,maybe, but we should at least log here
        } finally {
            await this.wait(this.pollInterval);
            this.poll();
        }
    }

    async removeExpired() {
        // get the current block number
        const blockNumber = await this.provider.getBlockNumber();
        // find all blocks that are expired past the finality depth
        // 102: currently we're mixing dates and blocks here - decide what it should be and name it appropriately
        const expiredAppointments = await this.store.getExpiredBefore(blockNumber - this.finalityDepth);
        // wait for all appointments to be removed from the store and the subscribers
        await Promise.all([
            expiredAppointments.map(async a => {
                await this.store.remove(a.id);
                this.appointmentSubscriber.unsubscribe(a.id, a.getEventFilter());
            })
        ]);
    }
}

class WatchedAppointmentStore {
    private readonly appointmentsById: {
        [appointmentId: string]: IAppointment;
    } = {};
    private readonly appointmentsByStateLocator: {
        [appointmentStateLocator: string]: IAppointment;
    } = {};

    async addOrUpdate(appointment: IAppointment): Promise<void> {
        const currentAppointment = this.appointmentsByStateLocator[appointment.getStateLocator()];
        if (currentAppointment) {
            if (currentAppointment.getStateNonce() >= appointment.getStateNonce()) {
                // PISA: if we've been given a nonce lower than the one we have already we should silently swallow it, not throw an error
                // PISA: this is because we shouldn't be giving out information about what appointments are already in place
                // PISA: we throw an error for now, with low information, but this should be removed.
                throw new Error("haha");
            } else {
                // the appointment exists, and we're replacing it, so remove from our id index
                this.appointmentsById[currentAppointment.id] = undefined;
            }
        }
        this.appointmentsByStateLocator[appointment.getStateLocator()] = appointment;
        this.appointmentsById[appointment.id] = appointment;
    }

    async remove(appointmentId: string): Promise<void> {
        const appointmentById = this.appointmentsById[appointmentId];
        // remove the appointment from the id index
        this.appointmentsById[appointmentId] = undefined;

        // remove the appointment from the state locator index
        const currentAppointment = this.appointmentsByStateLocator[appointmentById.getStateLocator()];
        // if it has the same id
        if (currentAppointment.id === appointmentId)
            this.appointmentsByStateLocator[appointmentById.getStateLocator()] = undefined;
    }

    async getExpiredBefore(blockNumber: number): Promise<IAppointment[]> {
        // 102: very inefficient sort, only useful for small appoinment numbers
        return Object.keys(this.appointmentsById)
            .map(a => this.appointmentsById[a])
            .filter(a => a.endTime < blockNumber);
    }
}
