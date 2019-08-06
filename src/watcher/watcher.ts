import { Appointment } from "../dataEntities";
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
    constructor(private cache: ReadOnlyBlockCache<IBlockStub & Logs>, private appointment: Appointment) {
        const filter = this.appointment.eventFilter;
        if (!filter.topics) throw new ApplicationError(`topics should not be undefined`);
    }
    public getInitialState(block: IBlockStub & Logs): WatcherAppointmentAnchorState {
        const filter = this.appointment.eventFilter;

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
            hasLogMatchingEventFilter(block, this.appointment.eventFilter)
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

export enum WatcherActionKind {
    StartResponse = 1,
    RemoveAppointment = 2
}

type StartResponseAction = {
    kind: WatcherActionKind.StartResponse;
    appointment: Appointment;
};

type RemoveAppointmentAction = {
    kind: WatcherActionKind.RemoveAppointment;
    appointmentId: string;
};

export type WatcherAction = StartResponseAction | RemoveAppointmentAction;

/**
 * Watches the chain for events related to the supplied appointments. When an event is noticed data is forwarded to the
 * observe method to complete the task. The watcher is not responsible for ensuring that observed events are properly
 * acted upon, that is the responsibility of the responder.
 */
export class Watcher extends Component<WatcherAnchorState, IBlockStub & Logs, WatcherAction> {
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
                appointment => new WatcherAppointmentStateReducer(blockCache, appointment),
                appointment => appointment.id,
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

    private shouldRemoveObservedAppointment = (
        state: WatcherAnchorState,
        appointmentState: WatcherAppointmentAnchorState | undefined
    ): boolean =>
        appointmentState != undefined &&
        appointmentState.state === WatcherAppointmentState.OBSERVED &&
        state.blockNumber - appointmentState.blockObserved + 1 >= this.confirmationsBeforeRemoval;

    private shouldRemoveExpiredAppointment = (
        state: WatcherAnchorState,
        appointmentState: WatcherAppointmentAnchorState | undefined,
        endBlock: number
    ): boolean =>
        appointmentState != undefined &&
        appointmentState.state === WatcherAppointmentState.WATCHING &&
        state.blockNumber - endBlock > this.confirmationsBeforeRemoval;

    public detectChanges(prevState: WatcherAnchorState, state: WatcherAnchorState) {
        const actions: WatcherAction[] = [];

        for (const [appointmentId, appointmentState] of state.items.entries()) {
            const prevWatcherAppointmentState = prevState.items.get(appointmentId);

            // Log if started watching a new appointment
            if (!prevWatcherAppointmentState && appointmentState.state === WatcherAppointmentState.WATCHING) {
                logger.info(
                    { state: appointmentState, id: appointmentId, blockNumber: state.blockNumber },
                    `Started watching for appointment.`
                );
            }

            // Start response if necessary
            if (
                !this.shouldHaveStartedResponder(prevState, prevWatcherAppointmentState) &&
                this.shouldHaveStartedResponder(state, appointmentState)
            ) {
                const appointment = this.store.appointmentsById.get(appointmentId)!;
                logger.info({ state: appointmentState, id: appointmentId, blockNumber: state.blockNumber }, `Responding to appointment.`); // prettier-ignore
                actions.push({
                    kind: WatcherActionKind.StartResponse,
                    appointment: appointment
                });
            }

            // Cleanup if done with appointment
            if (
                !this.shouldRemoveObservedAppointment(prevState, prevWatcherAppointmentState) &&
                this.shouldRemoveObservedAppointment(state, appointmentState)
            ) {
                logger.info({ state: appointmentState, id: appointmentId, blockNumber: state.blockNumber }, `Removing fulfilled appointment from watcher.`); // prettier-ignore
                actions.push({ kind: WatcherActionKind.RemoveAppointment, appointmentId: appointmentId });
            }

            // Cleanup if appointment expired
            let endBlock = this.store.appointmentsById.get(appointmentId)!.endBlock;
            if (
                !this.shouldRemoveExpiredAppointment(prevState, prevWatcherAppointmentState, endBlock) &&
                this.shouldRemoveExpiredAppointment(state, appointmentState, endBlock)
            ) {
                logger.info({ state: appointmentState, id: appointmentId, blockNumber: state.blockNumber }, `Removing expired appointment from watcher.`); // prettier-ignore
                actions.push({ kind: WatcherActionKind.RemoveAppointment, appointmentId: appointmentId });
            }
        }

        return actions;
    }

    public async handleChanges(actions: WatcherAction[]) {
        for (const action of actions) {
            switch (action.kind) {
                case WatcherActionKind.StartResponse:
                    await this.responder.startResponse(action.appointment);
                    break;
                case WatcherActionKind.RemoveAppointment:
                    await this.store.removeById(action.appointmentId);
                    break;
                default:
                    throw new ArgumentError("Unrecognised action kind.", action);
            }
        }
    }
}
