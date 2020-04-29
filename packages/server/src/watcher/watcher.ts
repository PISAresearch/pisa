import { Appointment } from "../dataEntities/appointment";
import { ApplicationError, ArgumentError, UnreachableCaseError } from "@pisa-research/errors";
import { AppointmentStore } from "./store";
import { ReadOnlyBlockCache, IBlockStub, hasLogMatchingEventFilter, Logs } from "@pisa-research/block";
import { StateReducer, MappedStateReducer, MappedState, Component, BlockNumberState, BlockNumberReducer } from "@pisa-research/block";
import { logger } from "@pisa-research/utils";
import { MultiResponder } from "../responder";
import { EventFilter } from "ethers";

export enum WatcherAppointmentState {
    WATCHING,
    OBSERVED
}

/** Portion of the anchor state for a single appointment */

type WatcherAppointmentAnchorStateWatching = {
    state: WatcherAppointmentState.WATCHING;
};

type WatcherAppointmentAnchorStateObserved = {
    state: WatcherAppointmentState.OBSERVED;
    blockObserved: number; // block number in which the event was observed
};

export type WatcherAppointmentAnchorState = WatcherAppointmentAnchorStateWatching | WatcherAppointmentAnchorStateObserved;

/** The complete anchor state for the watcher, that also includes the block number */
type WatcherAnchorState = MappedState<WatcherAppointmentAnchorState> & BlockNumberState;

export class EventFilterStateReducer implements StateReducer<WatcherAppointmentAnchorState, IBlockStub & Logs> {
    constructor(private cache: ReadOnlyBlockCache<IBlockStub & Logs>, private filter: EventFilter, private startBlock: number) {
        if (!filter.topics) throw new ApplicationError(`topics should be defined`);
    }
    public async getInitialState(block: IBlockStub & Logs): Promise<WatcherAppointmentAnchorState> {
        const eventAncestor = this.cache.findAncestor(block.hash, ancestor => hasLogMatchingEventFilter(ancestor, this.filter), this.startBlock);

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
    public async reduce(prevState: WatcherAppointmentAnchorState, block: IBlockStub & Logs): Promise<WatcherAppointmentAnchorState> {
        if (prevState.state === WatcherAppointmentState.WATCHING && hasLogMatchingEventFilter(block, this.filter)) {
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
    blockObserved: number;
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
    public readonly name = "watcher";

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
                appointment => {
                    const eventFilter = appointment.eventFilter;
                    return new EventFilterStateReducer(blockCache, eventFilter, appointment.startBlock);
                },
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
    ): appointmentState is WatcherAppointmentAnchorStateObserved =>
        appointmentState != undefined &&
        appointmentState.state === WatcherAppointmentState.OBSERVED &&
        state.blockNumber - appointmentState.blockObserved + 1 >= this.confirmationsBeforeResponse;

    private shouldRemoveObservedAppointment = (
        state: WatcherAnchorState,
        appointmentState: WatcherAppointmentAnchorState | undefined
    ): appointmentState is WatcherAppointmentAnchorStateObserved =>
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

        for (const appointmentId of Object.keys(state.items)) {
            const appointmentState = state.items[appointmentId];
            const prevWatcherAppointmentState = prevState.items[appointmentId];

            // Log if started watching a new appointment
            if (!prevWatcherAppointmentState && appointmentState.state === WatcherAppointmentState.WATCHING) {
                logger.info({ code: "p_wch_startapp", state: appointmentState, id: appointmentId, blockNumber: state.blockNumber }, `Started watching for appointment.`); // prettier-ignore
            }

            // Start response if necessary
            if (!this.shouldHaveStartedResponder(prevState, prevWatcherAppointmentState) && this.shouldHaveStartedResponder(state, appointmentState)) {
                const appointment = this.store.appointmentsById.get(appointmentId)!;
                logger.info({ code: "p_wch_respapp", state: appointmentState, id: appointmentId, blockNumber: state.blockNumber }, `Responding to appointment.`); // prettier-ignore
                actions.push({
                    kind: WatcherActionKind.StartResponse,
                    appointment: appointment,
                    blockObserved: appointmentState.blockObserved
                });
            }

            // Cleanup if done with appointment
            if (
                !this.shouldRemoveObservedAppointment(prevState, prevWatcherAppointmentState) &&
                this.shouldRemoveObservedAppointment(state, appointmentState)
            ) {
                logger.info({ code: "p_wch_rmfulfapp", state: appointmentState, id: appointmentId, blockNumber: state.blockNumber }, `Removing fulfilled appointment from watcher.`); // prettier-ignore
                actions.push({ kind: WatcherActionKind.RemoveAppointment, appointmentId: appointmentId });
            }

            // Cleanup if appointment expired
            let endBlock = this.store.appointmentsById.get(appointmentId)!.endBlock;
            if (
                !this.shouldRemoveExpiredAppointment(prevState, prevWatcherAppointmentState, endBlock) &&
                this.shouldRemoveExpiredAppointment(state, appointmentState, endBlock)
            ) {
                logger.info({ code: "p_wch_rmexpapp", state: appointmentState, id: appointmentId, blockNumber: state.blockNumber }, `Removing expired appointment from watcher.`); // prettier-ignore
                actions.push({ kind: WatcherActionKind.RemoveAppointment, appointmentId: appointmentId });
            }
        }

        return actions;
    }

    public async applyAction(action: WatcherAction) {
        switch (action.kind) {
            case WatcherActionKind.StartResponse:
                await this.responder.startResponse(
                    this.responder.pisaContractAddress,
                    action.appointment.encodeForResponse(),
                    action.appointment.gasLimit + MultiResponder.PisaGasAllowance,
                    action.appointment.id,
                    action.blockObserved,
                    action.blockObserved + action.appointment.challengePeriod
                );
                break;
            case WatcherActionKind.RemoveAppointment:
                await this.store.removeById(action.appointmentId);
                break;
            default:
                throw new UnreachableCaseError(action, "Unrecognised watcher action kind.");
        }
    }
}
