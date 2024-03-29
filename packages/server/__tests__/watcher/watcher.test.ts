import "mocha";
import { expect } from "chai";
import { mock, when, resetCalls, anything, anyNumber } from "ts-mockito";

import LevelUp from "levelup";
import EncodingDown from "encoding-down";
import MemDown from "memdown";

import { ApplicationError } from "@pisa-research/errors";
import { DbObject, defaultSerialiser, Logger } from "@pisa-research/utils";
import { BlockCache, BlockItemStore, IBlockStub, Logs } from "@pisa-research/block";
import { fnIt, throwingInstance } from "@pisa-research/test-utils";

import { AppointmentStore } from "../../src/watcher";
import { MultiResponder } from "../../src/responder";
import { Appointment } from "../../src/dataEntities/appointment";
import { EventFilterStateReducer, WatcherAppointmentState, Watcher, WatcherActionKind } from "../../src/watcher/watcher";

const logger = Logger.getLogger();

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

    const db = LevelUp(EncodingDown<string, DbObject>(MemDown(), { valueEncoding: "json" }));
    const blockStore = new BlockItemStore<IBlockStub & Logs>(db, defaultSerialiser, logger);

    const blockCache = new BlockCache<IBlockStub & Logs>(100, blockStore);

    before(async () => {
        await blockStore.start();
        await blockStore.withBatch(async () => {
            for (const b of blocks) {
                await blockCache.addBlock(b);
            }
        });
    });

    after(async () => {
        await blockStore.stop();
    });

    it("constructor throws ApplicationError if the topics are not set in the filter", () => {
        expect(() => new EventFilterStateReducer(blockCache, { address: "address" }, 0)).to.throw(ApplicationError);
    });

    fnIt<EventFilterStateReducer>(w => w.getInitialState, "initializes to WATCHING if event not present in ancestry", async () => {
        const asr = new EventFilterStateReducer(blockCache, observedEventFilter, startBlock);

        expect(await asr.getInitialState(blocks[1])).to.deep.equal({ state: WatcherAppointmentState.WATCHING });
    });

    fnIt<EventFilterStateReducer>(w => w.getInitialState, "initializes to OBSERVED if event is present in the last block", async () => {
        const asr = new EventFilterStateReducer(blockCache, observedEventFilter, startBlock);
        expect(await asr.getInitialState(blocks[2])).to.deep.equal({
            state: WatcherAppointmentState.OBSERVED,
            blockObserved: blocks[2].number
        });
    });

    fnIt<EventFilterStateReducer>(w => w.getInitialState, "initializes to OBSERVED if event is present in ancestry, updates blockObserved", async () => {
        const asr = new EventFilterStateReducer(blockCache, observedEventFilter, startBlock);
        expect(await asr.getInitialState(blocks[3])).to.deep.equal({
            state: WatcherAppointmentState.OBSERVED,
            blockObserved: blocks[2].number
        });
    });

    fnIt<EventFilterStateReducer>(w => w.reduce, "does not change state if event is not observed in new block", async () => {
        const asr = new EventFilterStateReducer(blockCache, observedEventFilter, startBlock);

        const result = await asr.reduce(
            {
                state: WatcherAppointmentState.WATCHING
            },
            blocks[1]
        );

        expect(result).to.deep.equal({ state: WatcherAppointmentState.WATCHING });
    });

    fnIt<EventFilterStateReducer>(w => w.getInitialState, "does not initialize to OBSERVED if event is present, but deeper than startBlock", async () => {
        // Appointment with same locator, but with startBlock past the event trigger
        const asr = new EventFilterStateReducer(blockCache, observedEventFilter, 3);
        expect(await asr.getInitialState(blocks[3])).to.deep.equal({
            state: WatcherAppointmentState.WATCHING
        });
    });

    fnIt<EventFilterStateReducer>(w => w.getInitialState, "does initialize to OBSERVED if event is present exactly at startBlock", async () => {
        // Appointment with same locator, but with startBlock past the event trigger
        const asr = new EventFilterStateReducer(blockCache, observedEventFilter, 2);
        expect(await asr.getInitialState(blocks[3])).to.deep.equal({
            state: WatcherAppointmentState.OBSERVED,
            blockObserved: 2
        });
    });

    fnIt<EventFilterStateReducer>(w => w.reduce, "does change state if event is observed in new block", async () => {
        const asr = new EventFilterStateReducer(blockCache, observedEventFilter, startBlock);

        const result = await asr.reduce(
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

    fnIt<EventFilterStateReducer>(w => w.reduce, "does not change from OBSERVED when new blocks come", async () => {
        const asr = new EventFilterStateReducer(blockCache, observedEventFilter, startBlock);

        const result = await asr.reduce(
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

    const db = LevelUp(EncodingDown<string, DbObject>(MemDown(), { valueEncoding: "json" }));
    let blockStore: BlockItemStore<IBlockStub & Logs>;
    let blockCache: BlockCache<IBlockStub & Logs>;

    let mockedStore: AppointmentStore;
    let store: AppointmentStore;

    let mockedResponder: MultiResponder;
    let responder: MultiResponder;

    let appointment: Appointment;

    before(async () => {
        blockStore = new BlockItemStore<IBlockStub & Logs>(db, defaultSerialiser, logger);
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
        when(mockedResponder.pisaContractAddress).thenReturn(pisaContractAddress);
        when(
            mockedResponder.startResponse(pisaContractAddress, appointment.encodeForResponse(), anyNumber(), appointment.id, anything(), anything())
        ).thenResolve();
        responder = throwingInstance(mockedResponder);
    });

    afterEach(() => {
        resetCalls(mockedResponder);
    });

    after(async () => {
        await blockStore.stop();
    });

    fnIt<Watcher>(w => w.detectChanges, "calls startResponse after event is OBSERVED for long enough", async () => {
        const watcher = new Watcher(responder, blockCache, store, logger, CONFIRMATIONS_BEFORE_RESPONSE, CONFIRMATIONS_BEFORE_REMOVAL);

        const actions = watcher.detectChanges(
            {
                items: { [appointment.id]: { state: WatcherAppointmentState.OBSERVED, blockObserved: 2 } },
                blockNumber: 2 + CONFIRMATIONS_BEFORE_RESPONSE - 2
            },
            {
                items: { [appointment.id]: { state: WatcherAppointmentState.OBSERVED, blockObserved: 2 } },
                blockNumber: 2 + CONFIRMATIONS_BEFORE_RESPONSE - 1
            }
        );
        expect(actions).to.deep.equal([{ kind: WatcherActionKind.StartResponse, appointment: appointment, blockObserved: 2 }]);
    });

    fnIt<Watcher>(w => w.detectChanges, "does not call startResponse before event is OBSERVED for long enough", async () => {
        const watcher = new Watcher(responder, blockCache, store, logger, CONFIRMATIONS_BEFORE_RESPONSE, CONFIRMATIONS_BEFORE_REMOVAL);

        const actions = watcher.detectChanges(
            {
                items: { [appointment.id]: { state: WatcherAppointmentState.OBSERVED, blockObserved: 2 } },
                blockNumber: 2 + CONFIRMATIONS_BEFORE_RESPONSE - 3
            },
            {
                items: { [appointment.id]: { state: WatcherAppointmentState.OBSERVED, blockObserved: 2 } },
                blockNumber: 2 + CONFIRMATIONS_BEFORE_RESPONSE - 2
            }
        );
        expect(actions).to.deep.equal([]);
    });

    fnIt<Watcher>(w => w.detectChanges, "calls startResponse immediately after event is OBSERVED for long enough even if just added to the store", async () => {
        const watcher = new Watcher(responder, blockCache, store, logger, CONFIRMATIONS_BEFORE_RESPONSE, CONFIRMATIONS_BEFORE_REMOVAL);

        const actions = watcher.detectChanges(
            {
                items: {},
                blockNumber: 0
            },
            {
                items: { [appointment.id]: { state: WatcherAppointmentState.OBSERVED, blockObserved: 2 } },
                blockNumber: 2 + CONFIRMATIONS_BEFORE_RESPONSE - 1
            }
        );
        expect(actions).to.deep.equal([{ kind: WatcherActionKind.StartResponse, appointment: appointment, blockObserved: 2 }]);
    });

    fnIt<Watcher>(w => w.detectChanges, "does not call startResponse again if a previous state already caused startResponse", async () => {
        const watcher = new Watcher(responder, blockCache, store, logger, CONFIRMATIONS_BEFORE_RESPONSE, CONFIRMATIONS_BEFORE_REMOVAL);

        const actions = watcher.detectChanges(
            {
                items: { [appointment.id]: { state: WatcherAppointmentState.OBSERVED, blockObserved: 2 } },
                blockNumber: 2 + CONFIRMATIONS_BEFORE_RESPONSE - 1
            },
            {
                items: { [appointment.id]: { state: WatcherAppointmentState.OBSERVED, blockObserved: 2 } },
                blockNumber: 2 + CONFIRMATIONS_BEFORE_RESPONSE
            }
        );
        expect(actions).to.deep.equal([]);
    });

    fnIt<Watcher>(w => w.detectChanges, "calls removeById after event is OBSERVED for long enoug", async () => {
        const watcher = new Watcher(responder, blockCache, store, logger, CONFIRMATIONS_BEFORE_RESPONSE, CONFIRMATIONS_BEFORE_REMOVAL);

        const actions = watcher.detectChanges(
            {
                items: { [appointment.id]: { state: WatcherAppointmentState.OBSERVED, blockObserved: 2 } },
                blockNumber: 2 + CONFIRMATIONS_BEFORE_REMOVAL - 2
            },
            {
                items: { [appointment.id]: { state: WatcherAppointmentState.OBSERVED, blockObserved: 2 } },
                blockNumber: 2 + CONFIRMATIONS_BEFORE_REMOVAL - 1
            }
        );
        expect(actions).to.deep.equal([{ kind: WatcherActionKind.RemoveAppointment, appointmentId: appointment.id }]);
    });

    fnIt<Watcher>(w => w.detectChanges, "does not call removeById before event is OBSERVED for long enough", async () => {
        const watcher = new Watcher(responder, blockCache, store, logger, CONFIRMATIONS_BEFORE_RESPONSE, CONFIRMATIONS_BEFORE_REMOVAL);

        const actions = watcher.detectChanges(
            {
                items: { [appointment.id]: { state: WatcherAppointmentState.OBSERVED, blockObserved: 2 } },
                blockNumber: 2 + CONFIRMATIONS_BEFORE_REMOVAL - 3
            },
            {
                items: { [appointment.id]: { state: WatcherAppointmentState.OBSERVED, blockObserved: 2 } },
                blockNumber: 2 + CONFIRMATIONS_BEFORE_REMOVAL - 2
            }
        );
        expect(actions).to.deep.equal([]);
    });

    fnIt<Watcher>(w => w.detectChanges, "calls removeById after an appointment has expired for long enough", async () => {
        const watcher = new Watcher(responder, blockCache, store, logger, CONFIRMATIONS_BEFORE_RESPONSE, CONFIRMATIONS_BEFORE_REMOVAL);

        const actions = watcher.detectChanges(
            {
                items: { [appointment.id]: { state: WatcherAppointmentState.WATCHING } },
                blockNumber: 101 + CONFIRMATIONS_BEFORE_REMOVAL - 1
            },
            {
                items: { [appointment.id]: { state: WatcherAppointmentState.WATCHING } },
                blockNumber: 101 + CONFIRMATIONS_BEFORE_REMOVAL
            }
        );
        expect(actions).to.deep.equal([{ kind: WatcherActionKind.RemoveAppointment, appointmentId: appointment.id }]);
    });

    fnIt<Watcher>(w => w.detectChanges, "does not call removeById before an appointment has expired for long enough", async () => {
        const watcher = new Watcher(responder, blockCache, store, logger, CONFIRMATIONS_BEFORE_RESPONSE, CONFIRMATIONS_BEFORE_REMOVAL);

        const actions = watcher.detectChanges(
            {
                items: { [appointment.id]: { state: WatcherAppointmentState.WATCHING } },
                blockNumber: 101 + CONFIRMATIONS_BEFORE_REMOVAL - 2
            },
            {
                items: { [appointment.id]: { state: WatcherAppointmentState.WATCHING } },
                blockNumber: 101 + CONFIRMATIONS_BEFORE_REMOVAL - 1
            }
        );
        expect(actions).to.deep.equal([]);
    });

    fnIt<Watcher>(w => w.detectChanges, "does not call removeById if an appointment is already expired for long enough", async () => {
        const watcher = new Watcher(responder, blockCache, store, logger, CONFIRMATIONS_BEFORE_RESPONSE, CONFIRMATIONS_BEFORE_REMOVAL);

        const actions = watcher.detectChanges(
            {
                items: { [appointment.id]: { state: WatcherAppointmentState.WATCHING } },
                blockNumber: 101 + CONFIRMATIONS_BEFORE_REMOVAL
            },
            {
                items: { [appointment.id]: { state: WatcherAppointmentState.WATCHING } },
                blockNumber: 101 + CONFIRMATIONS_BEFORE_REMOVAL + 1
            }
        );

        expect(actions).to.deep.equal([]);
    });
});
