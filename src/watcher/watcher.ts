import { IEthereumAppointment, StartStopService } from "../dataEntities";
import logger from "../logger";
import { ConfigurationError } from "../dataEntities/errors";
import { AppointmentSubscriber } from "./appointmentSubscriber";
import { IAppointmentStore } from "./store";
import { ethers } from "ethers";
import { EthereumResponderManager } from "../responder";
import { ReorgDetector } from "../blockMonitor";
import { inspect } from "util";
import levelup, { LevelUp } from "levelup";
import leveldown from "leveldown";
import encodingDown from "encoding-down";
import EncodingDown from "encoding-down";
import { Readable } from "stream";
import { ReadStream, createReadStream } from "fs";

/**
 * Watches the chain for events related to the supplied appointments. When an event is noticed data is forwarded to the
 * observe method to complete the task. The watcher is not responsible for ensuring that observed events are properly
 * acted upon, that is the responsibility of the responder.
 */
export class Watcher extends StartStopService {
    /**
     * Watches the chain for events related to the supplied appointments. When an event is noticed data is forwarded to the
     * observe method to complete the task. The watcher is not responsible for ensuring that observed events are properly
     * acted upon, that is the responsibility of the responder.
     */
    public constructor(
        private readonly provider: ethers.providers.BaseProvider,
        private readonly responder: EthereumResponderManager,
        private readonly reorgDetecteor: ReorgDetector,
        private readonly appointmentSubscriber: AppointmentSubscriber,
        private readonly store: IAppointmentStore
    ) {
        super("Watcher");
        this.startReorg = this.startReorg.bind(this);
        this.endReorg = this.endReorg.bind(this);
    }
    private reorgInProgress: boolean;
    private startReorg() {
        this.reorgInProgress = true;
    }
    private endReorg(newHead: number) {
        this.reorgInProgress = false;
        this.provider.resetEventsBlock(newHead);
    }
    protected startInternal() {
        this.reorgDetecteor.on(ReorgDetector.REORG_START_EVENT, this.startReorg);
        this.reorgDetecteor.on(ReorgDetector.REORG_END_EVENT, this.endReorg);
    }
    protected stopInternal() {
        this.reorgDetecteor.removeListener(ReorgDetector.REORG_START_EVENT, this.startReorg);
        this.reorgDetecteor.removeListener(ReorgDetector.REORG_END_EVENT, this.endReorg);
    }

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

    /**
     * Start watch for an event specified by the appointment, and respond if it the event is raised.
     * @param appointment Contains information about where to watch for events, and what information to suppli as part of a response
     */
    public async addAppointment(appointment: IEthereumAppointment): Promise<boolean> {
        return await this.addAppointmentLog(appointment, async () => {
            if (!appointment.passedInspection) throw new ConfigurationError(`Inspection not passed.`);

            // update this appointment in the store
            const updated = await this.store.addOrUpdateByStateLocator(appointment);
            if (updated) {
                // remove the subscription, this is blocking code so we don't have to worry that an event will be observed
                // whilst we remove these listeners and add new ones
                const filter = appointment.getEventFilter();
                this.appointmentSubscriber.unsubscribeAll(filter);

                // subscribe the listener
                const listener = async (event: ethers.Event) => await this.observe(appointment, event);
                this.appointmentSubscriber.subscribe(appointment.id, filter, listener);
            }

            return updated;
        });
    }

    /** A helper method just for adding some logging */
    private async addAppointmentLog(
        appointment: IEthereumAppointment,
        addAppointment: (appointment: IEthereumAppointment) => Promise<boolean>
    ) {
        logger.info(appointment.formatLog(`Begin watching for event ${appointment.getEventName()}.`));

        // business logic
        const result = await addAppointment(appointment);

        if (result) {
            // the new appointment has a lower nonce than the one we're currently storing, so don't add it
            logger.info(appointment.formatLog(`Appointment added to watcher.`));
        } else {
            logger.info(
                appointment.formatLog(
                    `An appointment with a higher nonce than ${appointment.getStateNonce()} already exists. Appointment not added to watcher.`
                )
            );
        }

        return result;
    }

    /**
     * Calls the responder and removes the appointment from the store
     * @param appointment
     * @param event
     */
    public async observe(appointment: IEthereumAppointment, event: ethers.Event) {
        return await this.addObserveLogAndCatch(appointment, event, this.reorgInProgress, async () => {
            // pass the appointment to the responder to complete. At this point the job has completed as far as
            // the watcher is concerned, therefore although respond is an async function we do not need to await it for a result
            this.responder.respond(appointment);

            // register a reorg event
            this.reorgDetecteor.addReorgHeightListener(event.blockNumber!, async () => {
                await this.addAppointment(appointment);
            });

            // unsubscribe from the listener
            this.appointmentSubscriber.unsubscribe(appointment.id, appointment.getEventFilter());

            // after firing a response and adding the reorg event we can remove the appointment from the store
            await this.store.removeById(appointment.id);
        });
    }

    /** A helper method for wrapping a block in a catch, and logging relevant info */
    private async addObserveLogAndCatch(
        appointment: IEthereumAppointment,
        event: ethers.Event,
        reorgInProgress: boolean,
        observeEvent: () => Promise<void>
    ) {
        // this callback should not throw exceptions as they cannot be handled elsewhere
        try {
            logger.info(
                appointment.formatLog(
                    `Observed event ${appointment.getEventName()} in contract ${appointment.getContractAddress()}.`
                )
            );
            logger.debug(appointment.formatLog(`Event info: ${inspect(event)}`));

            if (!reorgInProgress) {
                await observeEvent();
            } else {
                logger.info(appointment.formatLog(`Reorg in prgress, doing nothing.`));
            }
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
