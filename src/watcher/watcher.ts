import { Appointment } from "../dataEntities";
import { ApplicationError, ArgumentError } from "../dataEntities/errors";
import { AppointmentStore } from "./store";
import { ReadOnlyBlockCache } from "../blockMonitor";
import { Block } from "../dataEntities/block";
import { EventFilter } from "ethers";
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

enum AppointmentState {
    WATCHING,
    OBSERVED,
    AUTOTRIGGERED
}

/** Portion of the anchor state for a single appointment */
type WatcherAppointmentAnchorState =
    | {
          state: AppointmentState.WATCHING;
      }
    | {
          state: AppointmentState.OBSERVED;
          blockObserved: number; // block number in which the event was observed
      }
    |
      {
        state: AppointmentState.AUTOTRIGGERED;
      };

/** The complete anchor state for the watcher, that also includes the block number */
type WatcherAnchorState = MappedState<WatcherAppointmentAnchorState> & BlockNumberState;

// TODO:198: move this to a utility function somewhere
const hasLogMatchingEvent = (block: Block, filter: EventFilter): boolean => {
    return block.logs.some(
        log => log.address === filter.address && filter.topics!.every((topic, idx) => log.topics[idx] === topic)
    );
};

class AppointmentStateReducer implements StateReducer<WatcherAppointmentAnchorState, Block> {
    constructor(private cache: ReadOnlyBlockCache<Block>, private appointment: Appointment) {}
    public getInitialState(block: Block): WatcherAppointmentAnchorState {
        const filter = this.appointment.getEventFilter();
        if (!filter.topics) throw new ApplicationError(`topics should not be undefined`);
        
        // Pretty ugly hack, we should have a field in the appointment that specifies if it is autotriggerable or not
        if (this.appointment.eventABI  === 'autotriggerable'){
            logger.info(`Auto-triggerable appointment ${this.appointment.uniqueJobId()}.`); // prettier-ignore
            return {
                state: AppointmentState.AUTOTRIGGERED
            };
        } else {
            const eventAncestor = this.cache.findAncestor(block.hash, ancestor => hasLogMatchingEvent(ancestor, filter));

            if (!eventAncestor) {
                logger.info(`Watching for appointment ${this.appointment.uniqueJobId()}.`);
                return {
                    state: AppointmentState.WATCHING
                };
            } else {
                logger.info(`Initial observed appointment ${this.appointment.uniqueJobId()} in block ${eventAncestor.number}.`); // prettier-ignore
                return {
                    state: AppointmentState.OBSERVED,
                    blockObserved: eventAncestor.number
                };
            }
        }
    }
    public reduce(prevState: WatcherAppointmentAnchorState, block: Block): WatcherAppointmentAnchorState {
        if (
            prevState.state === AppointmentState.WATCHING &&
            hasLogMatchingEvent(block, this.appointment.getEventFilter())
        ) {
            logger.info(`Observed appointment ${this.appointment.uniqueJobId()} in block ${block.number}.`);
            return {
                state: AppointmentState.OBSERVED,
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
export class Watcher extends Component<WatcherAnchorState, Block> {
    /**
     * Watches the chain for events related to the supplied appointments. When an event is noticed data is forwarded to the
     * observe method to complete the task. The watcher is not responsible for ensuring that observed events are properly
     * acted upon, that is the responsibility of the responder.
     */
    constructor(
        private readonly responder: MultiResponder,
        blockCache: ReadOnlyBlockCache<Block>,
        private readonly store: AppointmentStore,
        private readonly confirmationsBeforeResponse: number,
        private readonly confirmationsBeforeRemoval: number
    ) {
        super(
            new MappedStateReducer(
                () => store.getAll(),
                appointment => new AppointmentStateReducer(blockCache, appointment),
                appointment => appointment.uniqueJobId(),
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
        (
            (appointmentState.state === AppointmentState.OBSERVED &&
            state.blockNumber - appointmentState.blockObserved + 1 >= this.confirmationsBeforeResponse) 
        ||
            appointmentState.state === AppointmentState.AUTOTRIGGERED
        );

    private shouldRemoveAppointment = (
        state: WatcherAnchorState,
        appointmentState: WatcherAppointmentAnchorState | undefined
    ): boolean =>
        appointmentState != undefined &&
        appointmentState.state === AppointmentState.OBSERVED &&
        state.blockNumber - appointmentState.blockObserved + 1 >= this.confirmationsBeforeRemoval;

    public async handleChanges(prevState: WatcherAnchorState, state: WatcherAnchorState) {
        for (const [objId, appointmentState] of state.items.entries()) {
            const prevAppointmentState = prevState.items.get(objId);
            if (
                !this.shouldHaveStartedResponder(prevState, prevAppointmentState) &&
                this.shouldHaveStartedResponder(state, appointmentState)
            ) {
                const appointment = this.store.getById(objId);
                logger.info(`Responding to appointment ${objId}, block ${state.blockNumber}.`);
                // pass the appointment to the responder to complete. At this point the job has completed as far as
                // the watcher is concerned, therefore although respond is an async function we do not need to await it for a result
                await this.responder.startResponse(appointment);
            }

            if (
                !this.shouldRemoveAppointment(prevState, prevAppointmentState) &&
                this.shouldRemoveAppointment(state, appointmentState)
            ) {
                logger.info(`Removing appointment ${objId}, block ${state.blockNumber} from watcher.`);
                await this.store.removeById(objId);
            }
        }
    }
}
