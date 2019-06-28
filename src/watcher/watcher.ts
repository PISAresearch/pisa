import { IEthereumAppointment, StartStopService } from "../dataEntities";
import { ConfigurationError, ApplicationError } from "../dataEntities/errors";
import { EthereumResponderManager } from "../responder";
import { AppointmentStore } from "./store";
import { BlockProcessor } from "../blockMonitor";
import { Block } from "../dataEntities/block";
import { EventFilter } from "ethers";
import { BlockchainMachine } from "../blockMonitor/blockchainMachine";

type AppointmentState =
    | {
          state: "watching";
      }
    | {
          state: "observed";
          blockObserved: number;
      };

export type AppointmentsState = {
    [appointmentId: string]: Readonly<AppointmentState> | undefined;
};

// TODO: move this to a utility function somewhere
const hasLogMatchingEvent = (block: Block, filter: EventFilter): boolean => {
    return block.logs.some(
        log => log.address === filter.address && filter.topics!.every((topic, idx) => log.topics[idx] === topic)
    );
};

/**
 * Watches the chain for events related to the supplied appointments. When an event is noticed data is forwarded to the
 * observe method to complete the task. The watcher is not responsible for ensuring that observed events are properly
 * acted upon, that is the responsibility of the responder.
 */
export class Watcher extends StartStopService {
    private blockchainMachine: BlockchainMachine<AppointmentsState, Block>;
    private appointmentsState: AppointmentsState = {};

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

        this.blockchainMachine = new BlockchainMachine<AppointmentsState, Block>(blockProcessor, {}, this.reducer);

        this.handleNewStateEvent = this.handleNewStateEvent.bind(this);
    }

    private reduceAppointmentState(
        appointment: IEthereumAppointment,
        prevAppointmentState: AppointmentState | undefined,
        block: Block
    ): AppointmentState {
        if (!prevAppointmentState) {
            // Compute from the cache
            return this.getAppointmentState(appointment, block);
        } else {
            if (prevAppointmentState.state === "watching" && hasLogMatchingEvent(block, appointment.getEventFilter())) {
                return {
                    state: "observed",
                    blockObserved: block.number
                };
            } else {
                return prevAppointmentState;
            }
        }
    }

    private reducer = (prevAppointmentsState: AppointmentsState, block: Block): AppointmentsState => {
        const result: AppointmentsState = {};
        const appointments = this.store.getAll();
        for (const appointment of appointments) {
            result[appointment.id] = this.reduceAppointmentState(
                appointment,
                prevAppointmentsState[appointment.id],
                block
            );
        }
        return result;
    };

    private async handleNewStateEvent(
        head: Block,
        state: AppointmentsState,
        prevHead: Block | null,
        prevState: AppointmentsState | null
    ) {
        const shouldHaveStartedResponder = (
            block: Block | null | undefined,
            st: AppointmentState | null | undefined
        ): boolean => {
            if (!st) return false;
            return st.state === "observed" && block!.number >= st.blockObserved + this.blocksDelay;
        };

        for (const appointment of this.store.getAll()) {
            const appState = state[appointment.id];
            const prevAppState = prevState && prevState[appointment.id]; // previous state for this appointment
            if (shouldHaveStartedResponder(head, appState) && !shouldHaveStartedResponder(prevHead, prevAppState)) {
                // start the responder
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
                            `An unexpected error occured whilst responding to event ${appointment.getEventName()} in contract ${appointment.getContractAddress()}.`
                        )
                    );
                    this.logger.error(appointment.formatLog(doh));
                }
            }
        }
    }

    protected async startInternal() {
        this.blockchainMachine.on(BlockchainMachine.NEW_STATE_EVENT, this.handleNewStateEvent);

        // Get the initial appointment states
        for (const appointment of this.store.getAll()) {
            this.appointmentsState[appointment.id] = this.getAppointmentState(appointment, this.blockProcessor.head);
        }
    }
    protected async stopInternal() {
        this.blockchainMachine.off(BlockchainMachine.NEW_STATE_EVENT, this.handleNewStateEvent);
    }

    // Gets the appointment state based on the whole history
    private getAppointmentState(appointment: IEthereumAppointment, head: Block): AppointmentState {
        const filter = appointment.getEventFilter();
        if (!filter.topics) throw new ApplicationError(`topics should not be undefined`);

        const eventAncestor = this.blockProcessor.blockCache.findAncestor(head.hash, block =>
            hasLogMatchingEvent(block, filter)
        );

        if (!eventAncestor) {
            return {
                state: "watching"
            };
        } else {
            return {
                state: "observed",
                blockObserved: eventAncestor.number
            };
        }
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
