import "mocha";
import { expect } from "chai";
import { mock, when, resetCalls, anything, anyNumber } from "ts-mockito";

import LevelUp from "levelup";
import EncodingDown from "encoding-down";
import MemDown from "memdown";

import { AppointmentStore } from "../../../src/watcher";
import { MultiResponder } from "../../../src/responder";
import { BlockCache } from "../../../src/blockMonitor";
import { ApplicationError, IBlockStub, Logs, Appointment, BlockItemStore } from "../../../src/dataEntities";
import {
    EventFilterStateReducer,
    WatcherAppointmentState,
    Watcher,
    WatcherAppointmentAnchorState,
    WatcherActionKind
} from "../../../src/watcher/watcher";
import fnIt from "../../utils/fnIt";
import throwingInstance from "../../utils/throwingInstance";

const observedEventAddress = "0x1234abcd";
const observedEventTopics = ["0x1234"];
const observedEventFilter = {
    address: observedEventAddress,
    topics: observedEventTopics
};
const startBlock = 0;

const blocks: (IBlockStub & Logs)[] = [
    {
        hash: "hash0",
        number: 0,
        parentHash: "hash",
        logs: []
    },
    {
        hash: "hash1",
        number: 1,
        parentHash: "hash0",
        logs: []
    },
    {
        hash: "hash2",
        number: 2,
        parentHash: "hash1",
        logs: [
            {
                address: observedEventAddress,
                data: "",
                topics: observedEventTopics
            }
        ]
    },
    {
        hash: "hash3",
        number: 3,
        parentHash: "hash2",
        logs: []
    }
];

describe("WatcherAppointmentStateReducer", () => {
    const appMock = mock(Appointment);
    when(appMock.eventFilter).thenReturn({
        address: observedEventAddress,
        topics: observedEventTopics
    });
    when(appMock.id).thenReturn("app1");
    when(appMock.startBlock).thenReturn(0);
    when(appMock.endBlock).thenReturn(1000);

    const db = LevelUp(EncodingDown<string, any>(MemDown(), { valueEncoding: "json" }));
    const blockStore = new BlockItemStore<IBlockStub & Logs>(db);

    const blockCache = new BlockCache<IBlockStub & Logs>(100, blockStore);

    before(async () => {
        await blockStore.start();
        await blockStore.withBatch(async () => {
            for (const b of blocks) {
                await blockCache.addBlock(b);
            }
        });
    });

    it("constructor throws ApplicationError if the topics are not set in the filter", () => {
        expect(() => new EventFilterStateReducer(blockCache, { address: "address" }, 0)).to.throw(ApplicationError);
    });

    fnIt<EventFilterStateReducer>(
        w => w.getInitialState,
        "initializes to WATCHING if event not present in ancestry",
        () => {
            const asr = new EventFilterStateReducer(blockCache, observedEventFilter, startBlock);

            expect(asr.getInitialState(blocks[1])).to.deep.equal({ state: WatcherAppointmentState.WATCHING });
        }
    );

    fnIt<EventFilterStateReducer>(
        w => w.getInitialState,
        "initializes to OBSERVED if event is present in the last block",
        () => {
            const asr = new EventFilterStateReducer(blockCache, observedEventFilter, startBlock);
            expect(asr.getInitialState(blocks[2])).to.deep.equal({
                state: WatcherAppointmentState.OBSERVED,
                blockObserved: blocks[2].number
            });
        }
    );

    fnIt<EventFilterStateReducer>(
        w => w.getInitialState,
        "initializes to OBSERVED if event is present in ancestry, updates blockObserved",
        () => {
            const asr = new EventFilterStateReducer(blockCache, observedEventFilter, startBlock);
            expect(asr.getInitialState(blocks[3])).to.deep.equal({
                state: WatcherAppointmentState.OBSERVED,
                blockObserved: blocks[2].number
            });
        }
    );

    fnIt<EventFilterStateReducer>(w => w.reduce, "does not change state if event is not observed in new block", () => {
        const asr = new EventFilterStateReducer(blockCache, observedEventFilter, startBlock);

        const result = asr.reduce(
            {
                state: WatcherAppointmentState.WATCHING
            },
            blocks[1]
        );

        expect(result).to.deep.equal({ state: WatcherAppointmentState.WATCHING });
    });

    fnIt<EventFilterStateReducer>(
        w => w.getInitialState,
        "does not initialize to OBSERVED if event is present, but deeper than startBlock",
        () => {
            // Appointment with same locator, but with startBlock past the event trigger
            const asr = new EventFilterStateReducer(blockCache, observedEventFilter, 3);
            expect(asr.getInitialState(blocks[3])).to.deep.equal({
                state: WatcherAppointmentState.WATCHING
            });
        }
    );

    fnIt<EventFilterStateReducer>(
        w => w.getInitialState,
        "does initialize to OBSERVED if event is present exactly at startBlock",
        () => {
            // Appointment with same locator, but with startBlock past the event trigger
            const asr = new EventFilterStateReducer(blockCache, observedEventFilter, 2);
            expect(asr.getInitialState(blocks[3])).to.deep.equal({
                state: WatcherAppointmentState.OBSERVED,
                blockObserved: 2
            });
        }
    );

    fnIt<EventFilterStateReducer>(w => w.reduce, "does change state if event is observed in new block", () => {
        const asr = new EventFilterStateReducer(blockCache, observedEventFilter, startBlock);

        const result = asr.reduce(
            {
                state: WatcherAppointmentState.WATCHING
            },
            blocks[2]
        );

        expect(result).to.deep.equal({
            state: WatcherAppointmentState.OBSERVED,
            blockObserved: blocks[2].number
        });
    });

    fnIt<EventFilterStateReducer>(w => w.reduce, "does not change from OBSERVED when new blocks come", () => {
        const asr = new EventFilterStateReducer(blockCache, observedEventFilter, startBlock);

        const result = asr.reduce(
            {
                state: WatcherAppointmentState.OBSERVED,
                blockObserved: blocks[2].number
            },
            blocks[2]
        );

        expect(result).to.deep.equal({
            state: WatcherAppointmentState.OBSERVED,
            blockObserved: blocks[2].number
        });
    });
});

describe("Watcher", () => {
    const CONFIRMATIONS_BEFORE_RESPONSE = 4;
    const CONFIRMATIONS_BEFORE_REMOVAL = 20;

    const db = LevelUp(EncodingDown<string, any>(MemDown(), { valueEncoding: "json" }));
    let blockStore: BlockItemStore<IBlockStub & Logs>;
    let blockCache: BlockCache<IBlockStub & Logs>;

    let mockedStore: AppointmentStore;
    let store: AppointmentStore;

    let mockedResponder: MultiResponder;
    let responder: MultiResponder;

    let appointment: Appointment;

    before(async () => {
        blockStore = new BlockItemStore<IBlockStub & Logs>(db);
        await blockStore.start();

        blockCache = new BlockCache<IBlockStub & Logs>(100, blockStore);

        blockStore.withBatch(async () => {
            for (const b of blocks) {
                await blockCache.addBlock(b);
            }
        });
    });

    beforeEach(() => {
        const appMock = mock(Appointment);
        when(appMock.id).thenReturn("app1");
        when(appMock.endBlock).thenReturn(100);
        when(appMock.encodeForResponse()).thenReturn("data1");
        appointment = throwingInstance(appMock);

        mockedStore = mock(AppointmentStore);
        when(mockedStore.getAll()).thenReturn([appointment]);
        when(mockedStore.removeById(anything())).thenResolve();
        const appointmentsById = new Map<string, Appointment>();
        appointmentsById.set(appointment.id, appointment);
        when(mockedStore.appointmentsById).thenReturn(appointmentsById);
        store = throwingInstance(mockedStore);

        mockedResponder = mock(MultiResponder);
        const pisaContractAddress = "pisa_address";
        when(mockedResponder.pisaContractAddress).thenReturn(pisaContractAddress)
        when(mockedResponder.startResponse(pisaContractAddress, appointment.encodeForResponse(), anyNumber(), appointment.id, anything(), anything())).thenResolve();
        responder = throwingInstance(mockedResponder);
    });

    function makeMap(appId: string, appState: WatcherAppointmentAnchorState) {
        return new Map<string, WatcherAppointmentAnchorState>([[appId, appState]]);
    }

    afterEach(() => {
        resetCalls(mockedResponder);
    });

    fnIt<Watcher>(w => w.detectChanges, "calls startResponse after event is OBSERVED for long enough", async () => {
        const watcher = new Watcher(responder, blockCache, store, CONFIRMATIONS_BEFORE_RESPONSE, CONFIRMATIONS_BEFORE_REMOVAL);

        const actions = watcher.detectChanges(
            {
                items: makeMap(appointment.id, { state: WatcherAppointmentState.OBSERVED, blockObserved: 2 }),
                blockNumber: 2 + CONFIRMATIONS_BEFORE_RESPONSE - 2
            },
            {
                items: makeMap(appointment.id, { state: WatcherAppointmentState.OBSERVED, blockObserved: 2 }),
                blockNumber: 2 + CONFIRMATIONS_BEFORE_RESPONSE - 1
            }
        );
        expect(actions).to.deep.equal([{ kind: WatcherActionKind.StartResponse, appointment: appointment, blockObserved: 2 }]);
    });

    fnIt<Watcher>(w => w.detectChanges, "does not call startResponse before event is OBSERVED for long enough", async () => {
        const watcher = new Watcher(responder, blockCache, store, CONFIRMATIONS_BEFORE_RESPONSE, CONFIRMATIONS_BEFORE_REMOVAL);

        const actions = watcher.detectChanges(
            {
                items: makeMap(appointment.id, { state: WatcherAppointmentState.OBSERVED, blockObserved: 2 }),
                blockNumber: 2 + CONFIRMATIONS_BEFORE_RESPONSE - 3
            },
            {
                items: makeMap(appointment.id, { state: WatcherAppointmentState.OBSERVED, blockObserved: 2 }),
                blockNumber: 2 + CONFIRMATIONS_BEFORE_RESPONSE - 2
            }
        );
        expect(actions).to.deep.equal([]);
    });

    fnIt<Watcher>(w => w.detectChanges, "calls startResponse immediately after event is OBSERVED for long enough even if just added to the store", async () => {
        const watcher = new Watcher(responder, blockCache, store, CONFIRMATIONS_BEFORE_RESPONSE, CONFIRMATIONS_BEFORE_REMOVAL);

        const actions = watcher.detectChanges(
            {
                items: new Map<string, WatcherAppointmentAnchorState>(),
                blockNumber: 0
            },
            {
                items: makeMap(appointment.id, { state: WatcherAppointmentState.OBSERVED, blockObserved: 2 }),
                blockNumber: 2 + CONFIRMATIONS_BEFORE_RESPONSE - 1
            }
        );
        expect(actions).to.deep.equal([{ kind: WatcherActionKind.StartResponse, appointment: appointment, blockObserved: 2 }]);
    });

    fnIt<Watcher>(w => w.detectChanges, "does not call startResponse again if a previous state already caused startResponse", async () => {
        const watcher = new Watcher(responder, blockCache, store, CONFIRMATIONS_BEFORE_RESPONSE, CONFIRMATIONS_BEFORE_REMOVAL);

        const actions = watcher.detectChanges(
            {
                items: makeMap(appointment.id, { state: WatcherAppointmentState.OBSERVED, blockObserved: 2 }),
                blockNumber: 2 + CONFIRMATIONS_BEFORE_RESPONSE - 1
            },
            {
                items: makeMap(appointment.id, { state: WatcherAppointmentState.OBSERVED, blockObserved: 2 }),
                blockNumber: 2 + CONFIRMATIONS_BEFORE_RESPONSE
            }
        );
        expect(actions).to.deep.equal([]);
    });

    fnIt<Watcher>(w => w.detectChanges, "calls removeById after event is OBSERVED for long enoug", async () => {
        const watcher = new Watcher(responder, blockCache, store, CONFIRMATIONS_BEFORE_RESPONSE, CONFIRMATIONS_BEFORE_REMOVAL);

        const actions = watcher.detectChanges(
            {
                items: makeMap(appointment.id, { state: WatcherAppointmentState.OBSERVED, blockObserved: 2 }),
                blockNumber: 2 + CONFIRMATIONS_BEFORE_REMOVAL - 2
            },
            {
                items: makeMap(appointment.id, { state: WatcherAppointmentState.OBSERVED, blockObserved: 2 }),
                blockNumber: 2 + CONFIRMATIONS_BEFORE_REMOVAL - 1
            }
        );
        expect(actions).to.deep.equal([{ kind: WatcherActionKind.RemoveAppointment, appointmentId: appointment.id }]);
    });

    fnIt<Watcher>(w => w.detectChanges, "does not call removeById before event is OBSERVED for long enough", async () => {
        const watcher = new Watcher(responder, blockCache, store, CONFIRMATIONS_BEFORE_RESPONSE, CONFIRMATIONS_BEFORE_REMOVAL);

        const actions = watcher.detectChanges(
            {
                items: makeMap(appointment.id, { state: WatcherAppointmentState.OBSERVED, blockObserved: 2 }),
                blockNumber: 2 + CONFIRMATIONS_BEFORE_REMOVAL - 3
            },
            {
                items: makeMap(appointment.id, { state: WatcherAppointmentState.OBSERVED, blockObserved: 2 }),
                blockNumber: 2 + CONFIRMATIONS_BEFORE_REMOVAL - 2
            }
        );
        expect(actions).to.deep.equal([]);
    });

    fnIt<Watcher>(w => w.detectChanges, "calls removeById after an appointment has expired for long enough", async () => {
        const watcher = new Watcher(responder, blockCache, store, CONFIRMATIONS_BEFORE_RESPONSE, CONFIRMATIONS_BEFORE_REMOVAL);

        const actions = watcher.detectChanges(
            {
                items: makeMap(appointment.id, { state: WatcherAppointmentState.WATCHING }),
                blockNumber: 101 + CONFIRMATIONS_BEFORE_REMOVAL - 1
            },
            {
                items: makeMap(appointment.id, { state: WatcherAppointmentState.WATCHING }),
                blockNumber: 101 + CONFIRMATIONS_BEFORE_REMOVAL
            }
        );
        expect(actions).to.deep.equal([{ kind: WatcherActionKind.RemoveAppointment, appointmentId: appointment.id }]);
    });

    fnIt<Watcher>(w => w.detectChanges, "does not call removeById before an appointment has expired for long enough", async () => {
        const watcher = new Watcher(responder, blockCache, store, CONFIRMATIONS_BEFORE_RESPONSE, CONFIRMATIONS_BEFORE_REMOVAL);

        const actions = watcher.detectChanges(
            {
                items: makeMap(appointment.id, { state: WatcherAppointmentState.WATCHING }),
                blockNumber: 101 + CONFIRMATIONS_BEFORE_REMOVAL - 2
            },
            {
                items: makeMap(appointment.id, { state: WatcherAppointmentState.WATCHING }),
                blockNumber: 101 + CONFIRMATIONS_BEFORE_REMOVAL - 1
            }
        );
        expect(actions).to.deep.equal([]);
    });

    fnIt<Watcher>(w => w.detectChanges, "does not call removeById if an appointment is already expired for long enough", async () => {
        const watcher = new Watcher(responder, blockCache, store, CONFIRMATIONS_BEFORE_RESPONSE, CONFIRMATIONS_BEFORE_REMOVAL);

        const actions = watcher.detectChanges(
            {
                items: makeMap(appointment.id, { state: WatcherAppointmentState.WATCHING }),
                blockNumber: 101 + CONFIRMATIONS_BEFORE_REMOVAL
            },
            {
                items: makeMap(appointment.id, { state: WatcherAppointmentState.WATCHING }),
                blockNumber: 101 + CONFIRMATIONS_BEFORE_REMOVAL + 1
            }
        );

        expect(actions).to.deep.equal([]);
    });
});
