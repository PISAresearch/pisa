import { IEthereumAppointment } from "../dataEntities";
import { ApplicationError, ArgumentError } from "../dataEntities/errors";
import { AppointmentStore } from "./store";
import { ReadOnlyBlockCache } from "../blockMonitor";
import { Logs, IBlockStub, hasLogMatchingEventFilter } from "../dataEntities/block";
import {
    StateReducer,
    MappedStateReducer,
    MappedState,
    Component,
    BlockNumberState,
    BlockNumberReducer
} from "../blockMonitor/component";
import logger from "../logger";
import { MultiResponder } from "../responder";

export enum WatcherAppointmentState {
    WATCHING,
    OBSERVED
}

/** Portion of the anchor state for a single appointment */
export type WatcherAppointmentAnchorState =
    | {
          state: WatcherAppointmentState.WATCHING;
      }
    | {
          state: WatcherAppointmentState.OBSERVED;
          blockObserved: number; // block number in which the event was observed
      };

/** The complete anchor state for the watcher, that also includes the block number */
type WatcherAnchorState = MappedState<WatcherAppointmentAnchorState> & BlockNumberState;

export class WatcherAppointmentStateReducer implements StateReducer<WatcherAppointmentAnchorState, IBlockStub & Logs> {
    constructor(private cache: ReadOnlyBlockCache<IBlockStub & Logs>, private appointment: IEthereumAppointment) {
        const filter = this.appointment.getEventFilter();
        if (!filter.topics) throw new ApplicationError(`topics should not be undefined`);
    }
    public getInitialState(block: IBlockStub & Logs): WatcherAppointmentAnchorState {
        const filter = this.appointment.getEventFilter();

        const eventAncestor = this.cache.findAncestor(block.hash, ancestor =>
            hasLogMatchingEventFilter(ancestor, filter)
        );

        if (!eventAncestor) {
            return {
                state: WatcherAppointmentState.WATCHING
            };
        } else {
            return {
                state: WatcherAppointmentState.OBSERVED,
                blockObserved: eventAncestor.number
            };
        }
    }
    public reduce(prevState: WatcherAppointmentAnchorState, block: IBlockStub & Logs): WatcherAppointmentAnchorState {
        if (
            prevState.state === WatcherAppointmentState.WATCHING &&
            hasLogMatchingEventFilter(block, this.appointment.getEventFilter())
        ) {
            return {
                state: WatcherAppointmentState.OBSERVED,
                blockObserved: block.number
            };
        } else {
            return prevState;
        }
    }
}

/**
 * Watches the chain for events related to the supplied appointments. When an event is noticed data is forwarded to the
 * observe method to complete the task. The watcher is not responsible for ensuring that observed events are properly
 * acted upon, that is the responsibility of the responder.
 */
export class Watcher extends Component<WatcherAnchorState, IBlockStub & Logs> {
    /**
     * Watches the chain for events related to the supplied appointments. When an event is noticed data is forwarded to the
     * observe method to complete the task. The watcher is not responsible for ensuring that observed events are properly
     * acted upon, that is the responsibility of the responder.
     */
    constructor(
        private readonly responder: MultiResponder,
        blockCache: ReadOnlyBlockCache<IBlockStub & Logs>,
        private readonly store: AppointmentStore,
        private readonly confirmationsBeforeResponse: number,
        private readonly confirmationsBeforeRemoval: number
    ) {
        super(
            new MappedStateReducer(
                () => store.getAll(),
                (appointment: IEthereumAppointment) => new WatcherAppointmentStateReducer(blockCache, appointment),
                new BlockNumberReducer()
            )
        );

        if (confirmationsBeforeResponse > confirmationsBeforeRemoval) {
            throw new ArgumentError(
                `confirmationsBeforeResponse must be less than or equal to confirmationsBeforeRemoval.`,
                confirmationsBeforeResponse,
                confirmationsBeforeRemoval
            );
        }
    }

    private shouldHaveStartedResponder = (
        state: WatcherAnchorState,
        appointmentState: WatcherAppointmentAnchorState | undefined
    ): boolean =>
        appointmentState != undefined &&
        appointmentState.state === WatcherAppointmentState.OBSERVED &&
        state.blockNumber - appointmentState.blockObserved + 1 >= this.confirmationsBeforeResponse;

    private shouldRemoveAppointment = (
        state: WatcherAnchorState,
        appointmentState: WatcherAppointmentAnchorState | undefined
    ): boolean =>
        appointmentState != undefined &&
        appointmentState.state === WatcherAppointmentState.OBSERVED &&
        state.blockNumber - appointmentState.blockObserved + 1 >= this.confirmationsBeforeRemoval;

    public async handleChanges(prevState: WatcherAnchorState, state: WatcherAnchorState) {
        for (const [appointmentId, appointmentState] of state.items.entries()) {
            const prevWatcherAppointmentState = prevState.items.get(appointmentId);

            // Log if started watching a new appointment
            if (!prevWatcherAppointmentState && appointmentState.state === WatcherAppointmentState.WATCHING) {
                logger.info(`Watching for appointment ${appointmentId}.`);
            }

            // Log if an appointment was observed, wether it is a new one or a previously watched one
            if (
                (!prevWatcherAppointmentState ||
                    prevWatcherAppointmentState.state === WatcherAppointmentState.WATCHING) &&
                appointmentState.state === WatcherAppointmentState.OBSERVED
            ) {
                logger.info(`Observed appointment ${appointmentId} in block ${appointmentState.blockObserved}.`);
            }

            // Start response if necessary
            if (
                !this.shouldHaveStartedResponder(prevState, prevWatcherAppointmentState) &&
                this.shouldHaveStartedResponder(state, appointmentState)
            ) {
                const appointment = this.store.appointmentsById.get(appointmentId)!;
                logger.info(`Responding to appointment ${appointmentId}, block ${state.blockNumber}.`);
                // pass the appointment to the responder to complete. At this point the job has completed as far as
                // the watcher is concerned, therefore although respond is an async function we do not need to await it for a result
                await this.responder.startResponse(appointment.id, appointment.getResponseData());
            }

            // Cleanup if done with appointment
            if (
                !this.shouldRemoveAppointment(prevState, prevWatcherAppointmentState) &&
                this.shouldRemoveAppointment(state, appointmentState)
            ) {
                logger.info(`Removing appointment ${appointmentId}, block ${state.blockNumber} from watcher.`);
                await this.store.removeById(appointmentId);
            }
        }
    }
}
