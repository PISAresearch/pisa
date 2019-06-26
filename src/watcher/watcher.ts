import { IEthereumAppointment, StartStopService } from "../dataEntities";
import { ConfigurationError, ApplicationError } from "../dataEntities/errors";
import { EthereumResponderManager } from "../responder";
import { AppointmentStore } from "./store";
import { BlockProcessor, BlockCache } from "../blockMonitor";
import { Block } from "../dataEntities/block";
import { EventFilter } from "ethers";

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
    constructor(
        private readonly responder: EthereumResponderManager,
        private readonly blockProcessor: BlockProcessor<Block>,
        private readonly store: AppointmentStore,
        private readonly blocksDelay: number
    ) {
        super("watcher");

        this.processNewHead = this.processNewHead.bind(this);
    }

    private findAncestorMatchingFilter(head: Block, filter: EventFilter) {
        if (!filter.topics) throw new ApplicationError(`topics should not be undefined`);

        return this.blockProcessor.blockCache.findAncestor(head.hash, block => {
            for (const log of block.logs) {
                // TODO: is this the right way of testing the event?
                if (log.address === filter.address && filter.topics!.every(topic => log.topics.includes(topic))) {
                    return true;
                }
            }
            return false;
        });
    }

    async processNewHead(head: Block, prevHead: Block | null) {
        for (const appointment of this.store.getAll()) {
            // for each appointment, check if we need to start the responder or not
            const filter = appointment.getEventFilter();

            // Find an ancestor with the right event log, if any
            const eventAncestor = this.findAncestorMatchingFilter(head, filter);

            if (eventAncestor && eventAncestor.number <= head.number - this.blocksDelay) {
                try {
                    this.logger.info(
                        appointment.formatLog(
                            `Observed event ${appointment.getEventName()} in contract ${appointment.getContractAddress()}.`
                        )
                    );
                    // TODO: add some logging to replace this
                    // this.logger.debug(appointment.formatLog(`Event info: ${inspect(event)}`));

                    // pass the appointment to the responder to complete. At this point the job has completed as far as
                    // the watcher is concerned, therefore although respond is an async function we do not need to await it for a result
                    this.responder.respond(appointment);

                    // after firing a response we can remove the appointment from the store
                    await this.store.removeById(appointment.id);
                } catch (doh) {
                    // an error occured whilst responding to the callback - this is serious and the problem needs to be correctly diagnosed
                    this.logger.error(
                        appointment.formatLog(
                            `An unexpected errror occured whilst responding to event ${appointment.getEventName()} in contract ${appointment.getContractAddress()}.`
                        )
                    );
                    this.logger.error(appointment.formatLog(doh));
                }
            }
        }
    }

    protected async startInternal() {
        this.blockProcessor.on(BlockProcessor.NEW_HEAD_EVENT, this.processNewHead);
    }
    protected async stopInternal() {
        this.blockProcessor.off(BlockProcessor.NEW_HEAD_EVENT, this.processNewHead);
    }

    /**
     * Starts watching for an event specified by the appointment, and respond if the event is raised.
     * Returns `true` if the supplied appointment was added or updated by the store, `false` otherwise.
     * @param appointment Contains information about where to watch for events, and what information to supply as part of a response
     */
    public async addAppointment(appointment: IEthereumAppointment): Promise<boolean> {
        if (!appointment.passedInspection) throw new ConfigurationError(`Inspection not passed.`);

        // update this appointment in the store, return true on success
        return await this.store.addOrUpdateByStateLocator(appointment);
    }
}
