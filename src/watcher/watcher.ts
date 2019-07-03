import { IEthereumAppointment } from "../dataEntities";
import { ApplicationError, ArgumentError } from "../dataEntities/errors";
import { EthereumResponderManager } from "../responder";
import { AppointmentStore } from "./store";
import { BlockProcessor } from "../blockMonitor";
import { Block } from "../dataEntities/block";
import { EventFilter } from "ethers";
import { Component } from "../blockMonitor/component";
import logger from "../logger";

enum AppointmentState {
    WATCHING,
    OBSERVED
}

/** Portion of the anchor state for a single appointment */
type WatcherAppointmentState =
    | {
          state: AppointmentState.WATCHING;
      }
    | {
          state: AppointmentState.OBSERVED;
          blockObserved: number; // block number in which the event was observed
      };

/** Anchor state for all appointments, indexed by appointment id */
export type WatcherAnchorState = {
    [appointmentId: string]: Readonly<WatcherAppointmentState> | undefined;
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
export class Watcher extends Component<WatcherAnchorState, Block> {
    private appointmentsState: WatcherAnchorState = {};

    /**
     * Watches the chain for events related to the supplied appointments. When an event is noticed data is forwarded to the
     * observe method to complete the task. The watcher is not responsible for ensuring that observed events are properly
     * acted upon, that is the responsibility of the responder.
     */
    constructor(
        private readonly responder: EthereumResponderManager,
        private readonly blockProcessor: BlockProcessor<Block>,
        private readonly store: AppointmentStore,
        private readonly confirmationsBeforeResponse: number,
        private readonly confirmationsBeforeRemoval: number
    ) {
        super();
        if (confirmationsBeforeResponse > confirmationsBeforeRemoval) {
            throw new ArgumentError(
                `confirmationsBeforeResponse must be less than or equal to confirmationsBeforeRemoval.`,
                confirmationsBeforeResponse,
                confirmationsBeforeRemoval
            );
        }

        // Get the initial appointment states
        for (const appointment of this.store.getAll()) {
            this.appointmentsState[appointment.id] = this.getWatcherAppointmentState(
                appointment,
                this.blockProcessor.head
            );
        }
    }

    // Computes the update of the state of a specific appointment
    private reduceWatcherAppointmentState(
        appointment: IEthereumAppointment,
        prevWatcherAppointmentState: WatcherAppointmentState | undefined,
        block: Block
    ): WatcherAppointmentState {
        if (!prevWatcherAppointmentState) {
            // Compute from the cache
            return this.getWatcherAppointmentState(appointment, block);
        } else {
            if (
                prevWatcherAppointmentState.state === AppointmentState.WATCHING &&
                hasLogMatchingEvent(block, appointment.getEventFilter())
            ) {
                return {
                    state: AppointmentState.OBSERVED,
                    blockObserved: block.number
                };
            } else {
                return prevWatcherAppointmentState;
            }
        }
    }

    // Reducer for the whole anchor state
    public reduce(prevWatcherAnchorState: WatcherAnchorState, block: Block): WatcherAnchorState {
        const result: WatcherAnchorState = {};
        const appointments = this.store.getAll();
        for (const appointment of appointments) {
            result[appointment.id] = this.reduceWatcherAppointmentState(
                appointment,
                prevWatcherAnchorState[appointment.id],
                block
            );
        }
        return result;
    }

    public async handleNewStateEvent(
        prevHead: Block,
        prevState: WatcherAnchorState,
        head: Block,
        state: WatcherAnchorState
    ) {
        const shouldHaveStartedResponder = (block: Block, st: WatcherAppointmentState | undefined): boolean => {
            if (!st) return false;
            return (
                st.state === AppointmentState.OBSERVED &&
                block!.number - st.blockObserved + 1 >= this.confirmationsBeforeResponse
            );
        };

        const shouldRemoveAppointment = (block: Block, st: WatcherAppointmentState | undefined): boolean => {
            if (!st) return false;
            return (
                st.state === AppointmentState.OBSERVED &&
                block!.number - st.blockObserved + 1 >= this.confirmationsBeforeRemoval
            );
        };

        for (const appointment of this.store.getAll()) {
            const appState = state[appointment.id];
            const prevAppState = prevState && prevState[appointment.id]; // previous state for this appointment
            if (shouldHaveStartedResponder(head, appState) && !shouldHaveStartedResponder(prevHead, prevAppState)) {
                // start the responder
                try {
                    logger.info(
                        appointment.formatLog(
                            `Observed event ${appointment.getEventName()} in contract ${appointment.getContractAddress()}.`
                        )
                    );

                    // TODO: add some logging to replace this
                    // this.logger.debug(appointment.formatLog(`Event info: ${inspect(event)}`));

                    // pass the appointment to the responder to complete. At this point the job has completed as far as
                    // the watcher is concerned, therefore although respond is an async function we do not need to await it for a result
                    this.responder.respond(appointment);
                } catch (doh) {
                    // an error occured whilst responding to the callback - this is serious and the problem needs to be correctly diagnosed
                    logger.error(
                        appointment.formatLog(
                            `An unexpected error occured whilst responding to event ${appointment.getEventName()} in contract ${appointment.getContractAddress()}.`
                        )
                    );
                    logger.error(appointment.formatLog(doh));
                }
            }

            if (shouldRemoveAppointment(head, appState) && !shouldRemoveAppointment(prevHead, prevAppState)) {
                // after enough confirmations (thus after the responder was hired) we can remove the appointment from the store
                await this.store.removeById(appointment.id);
            }
        }
    }

    // Gets the appointment state based on the whole history
    private getWatcherAppointmentState(appointment: IEthereumAppointment, head: Block): WatcherAppointmentState {
        const filter = appointment.getEventFilter();
        if (!filter.topics) throw new ApplicationError(`topics should not be undefined`);

        const eventAncestor = this.blockProcessor.blockCache.findAncestor(head.hash, block =>
            hasLogMatchingEvent(block, filter)
        );

        if (!eventAncestor) {
            return {
                state: AppointmentState.WATCHING
            };
        } else {
            return {
                state: AppointmentState.OBSERVED,
                blockObserved: eventAncestor.number
            };
        }
    }
}
