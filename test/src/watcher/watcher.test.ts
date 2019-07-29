import "mocha";
import { expect } from "chai";
import { mock, instance, when, resetCalls, verify } from "ts-mockito";
import { AppointmentStore } from "../../../src/watcher";
import { MultiResponder } from "../../../src/responder";
import { BlockCache } from "../../../src/blockMonitor";
import { ApplicationError, IBlockStub, Logs, Appointment } from "../../../src/dataEntities";
import {
    WatcherAppointmentStateReducer,
    WatcherAppointmentState,
    Watcher,
    WatcherAppointmentAnchorState
} from "../../../src/watcher/watcher";

const observedEventAddress = "0x1234abcd";
const observedEventTopics = ["0x1234"];

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
    const appointment = instance(appMock);

    const blockCache = new BlockCache<IBlockStub & Logs>(100);
    blocks.forEach(b => blockCache.addBlock(b));

    it("constructor throws ApplicationError if the topics are not set in the filter", () => {
        const emptyAppMock = mock(Appointment);
        when(emptyAppMock.eventFilter).thenReturn({});
        when(appMock.id).thenReturn("app1");
        const emptyAppointment = instance(emptyAppMock);

        expect(() => new WatcherAppointmentStateReducer(blockCache, emptyAppointment)).to.throw(ApplicationError);
    });

    it("getInitialState initializes to WATCHING if event not present in ancestry", () => {
        const asr = new WatcherAppointmentStateReducer(blockCache, appointment);

        expect(asr.getInitialState(blocks[1])).to.deep.equal({ state: WatcherAppointmentState.WATCHING });
    });

    it("getInitialState initializes to OBSERVED if event is present in the last block", () => {
        const asr = new WatcherAppointmentStateReducer(blockCache, appointment);
        expect(asr.getInitialState(blocks[2])).to.deep.equal({
            state: WatcherAppointmentState.OBSERVED,
            blockObserved: blocks[2].number
        });
    });

    it("getInitialState initializes to OBSERVED if event is present in ancestry, updates blockObserved", () => {
        const asr = new WatcherAppointmentStateReducer(blockCache, appointment);
        expect(asr.getInitialState(blocks[3])).to.deep.equal({
            state: WatcherAppointmentState.OBSERVED,
            blockObserved: blocks[2].number
        });
    });

    it("reduce does not change state if event is not observed in new block", () => {
        const asr = new WatcherAppointmentStateReducer(blockCache, appointment);

        const result = asr.reduce(
            {
                state: WatcherAppointmentState.WATCHING
            },
            blocks[1]
        );

        expect(result).to.deep.equal({ state: WatcherAppointmentState.WATCHING });
    });

    it("reduce does change state if event is observed in new block", () => {
        const asr = new WatcherAppointmentStateReducer(blockCache, appointment);

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

    it("reduce does not change from OBSERVED when new blocks come", () => {
        const asr = new WatcherAppointmentStateReducer(blockCache, appointment);

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

    const blockCache = new BlockCache<IBlockStub & Logs>(100);
    blocks.forEach(b => blockCache.addBlock(b));

    const mockedResponder = mock(MultiResponder);
    const responder = instance(mockedResponder);

    let mockedStore: AppointmentStore;
    let store: AppointmentStore;

    let appointment: Appointment;

    beforeEach(() => {
        const appMock = mock(Appointment);
        when(appMock.eventFilter).thenReturn({
            address: observedEventAddress,
            topics: observedEventTopics
        });
        when(appMock.id).thenReturn("app1");
        when(appMock.endBlock).thenReturn(100);
        appointment = instance(appMock);

        mockedStore = mock(AppointmentStore);
        when(mockedStore.getAll()).thenReturn([appointment]);
        const appointmentsById = new Map<string, Appointment>();
        appointmentsById.set(appointment.id, appointment);
        when(mockedStore.appointmentsById).thenReturn(appointmentsById);
        store = instance(mockedStore);
    });

    function makeMap(appId: string, appState: WatcherAppointmentAnchorState) {
        return new Map<string, WatcherAppointmentAnchorState>([[appId, appState]]);
    }

    afterEach(() => {
        resetCalls(mockedResponder);
    });

    it("handleChanges calls startResponse after event is OBSERVED for long enough", async () => {
        const watcher = new Watcher(
            responder,
            blockCache,
            store,
            CONFIRMATIONS_BEFORE_RESPONSE,
            CONFIRMATIONS_BEFORE_REMOVAL
        );

        await watcher.handleChanges(
            {
                items: makeMap(appointment.id, {
                    state: WatcherAppointmentState.OBSERVED,
                    blockObserved: 2
                }),
                blockNumber: 2 + CONFIRMATIONS_BEFORE_RESPONSE - 2
            },
            {
                items: makeMap(appointment.id, {
                    state: WatcherAppointmentState.OBSERVED,
                    blockObserved: 2
                }),
                blockNumber: 2 + CONFIRMATIONS_BEFORE_RESPONSE - 1
            }
        );

        verify(mockedResponder.startResponse(appointment)).once();
    });

    it("handleChanges does not call startResponse before event is OBSERVED for long enough", async () => {
        const watcher = new Watcher(
            responder,
            blockCache,
            store,
            CONFIRMATIONS_BEFORE_RESPONSE,
            CONFIRMATIONS_BEFORE_REMOVAL
        );

        await watcher.handleChanges(
            {
                items: makeMap(appointment.id, {
                    state: WatcherAppointmentState.OBSERVED,
                    blockObserved: 2
                }),
                blockNumber: 2 + CONFIRMATIONS_BEFORE_RESPONSE - 3
            },
            {
                items: makeMap(appointment.id, {
                    state: WatcherAppointmentState.OBSERVED,
                    blockObserved: 2
                }),
                blockNumber: 2 + CONFIRMATIONS_BEFORE_RESPONSE - 2
            }
        );

        verify(mockedResponder.startResponse(appointment)).never();
    });

    it("handleChanges calls startResponse immediately after event is OBSERVED for long enough even if just added to the store", async () => {
        const watcher = new Watcher(
            responder,
            blockCache,
            store,
            CONFIRMATIONS_BEFORE_RESPONSE,
            CONFIRMATIONS_BEFORE_REMOVAL
        );

        await watcher.handleChanges(
            {
                items: new Map<string, WatcherAppointmentAnchorState>(),
                blockNumber: 0
            },
            {
                items: makeMap(appointment.id, {
                    state: WatcherAppointmentState.OBSERVED,
                    blockObserved: 2
                }),
                blockNumber: 2 + CONFIRMATIONS_BEFORE_RESPONSE - 1
            }
        );

        verify(mockedResponder.startResponse(appointment)).once();
    });

    it("handleChanges does not call startResponse again if a previous state already caused startResponse", async () => {
        const watcher = new Watcher(
            responder,
            blockCache,
            store,
            CONFIRMATIONS_BEFORE_RESPONSE,
            CONFIRMATIONS_BEFORE_REMOVAL
        );

        await watcher.handleChanges(
            {
                items: makeMap(appointment.id, {
                    state: WatcherAppointmentState.OBSERVED,
                    blockObserved: 2
                }),
                blockNumber: 2 + CONFIRMATIONS_BEFORE_RESPONSE - 1
            },
            {
                items: makeMap(appointment.id, {
                    state: WatcherAppointmentState.OBSERVED,
                    blockObserved: 2
                }),
                blockNumber: 2 + CONFIRMATIONS_BEFORE_RESPONSE
            }
        );

        verify(mockedResponder.startResponse(appointment)).never();
    });

    it("handleChanges calls removeById after event is OBSERVED for long enough", async () => {
        const watcher = new Watcher(
            responder,
            blockCache,
            store,
            CONFIRMATIONS_BEFORE_RESPONSE,
            CONFIRMATIONS_BEFORE_REMOVAL
        );

        await watcher.handleChanges(
            {
                items: makeMap(appointment.id, {
                    state: WatcherAppointmentState.OBSERVED,
                    blockObserved: 2
                }),
                blockNumber: 2 + CONFIRMATIONS_BEFORE_REMOVAL - 2
            },
            {
                items: makeMap(appointment.id, {
                    state: WatcherAppointmentState.OBSERVED,
                    blockObserved: 2
                }),
                blockNumber: 2 + CONFIRMATIONS_BEFORE_REMOVAL - 1
            }
        );

        verify(mockedStore.removeById(appointment.id)).once();
    });

    it("handleChanges does not call removeById before event is OBSERVED for long enough", async () => {
        const watcher = new Watcher(
            responder,
            blockCache,
            store,
            CONFIRMATIONS_BEFORE_RESPONSE,
            CONFIRMATIONS_BEFORE_REMOVAL
        );

        await watcher.handleChanges(
            {
                items: makeMap(appointment.id, {
                    state: WatcherAppointmentState.OBSERVED,
                    blockObserved: 2
                }),
                blockNumber: 2 + CONFIRMATIONS_BEFORE_REMOVAL - 3
            },
            {
                items: makeMap(appointment.id, {
                    state: WatcherAppointmentState.OBSERVED,
                    blockObserved: 2
                }),
                blockNumber: 2 + CONFIRMATIONS_BEFORE_REMOVAL - 2
            }
        );

        verify(mockedStore.removeById(appointment.id)).never();
    });

    it("handleChanges calls removeById after an appointment has expired for long enough", async () => {
        const watcher = new Watcher(
            responder,
            blockCache,
            store,
            CONFIRMATIONS_BEFORE_RESPONSE,
            CONFIRMATIONS_BEFORE_REMOVAL
        );

        await watcher.handleChanges(
            {
                items: makeMap(appointment.id, {
                    state: WatcherAppointmentState.WATCHING
                }),
                blockNumber: 101 + CONFIRMATIONS_BEFORE_REMOVAL - 1
            },
            {
                items: makeMap(appointment.id, {
                    state: WatcherAppointmentState.WATCHING
                }),
                blockNumber: 101 + CONFIRMATIONS_BEFORE_REMOVAL
            }
        );

        verify(mockedStore.removeById(appointment.id)).once();
    });

    it("handleChanges dooes not call removeById before an appointment has expired for long enough", async () => {
        const watcher = new Watcher(
            responder,
            blockCache,
            store,
            CONFIRMATIONS_BEFORE_RESPONSE,
            CONFIRMATIONS_BEFORE_REMOVAL
        );

        await watcher.handleChanges(
            {
                items: makeMap(appointment.id, {
                    state: WatcherAppointmentState.WATCHING
                }),
                blockNumber: 101 + CONFIRMATIONS_BEFORE_REMOVAL - 2
            },
            {
                items: makeMap(appointment.id, {
                    state: WatcherAppointmentState.WATCHING
                }),
                blockNumber: 101 + CONFIRMATIONS_BEFORE_REMOVAL - 1
            }
        );

        verify(mockedStore.removeById(appointment.id)).never();
    });

    it("handleChanges dooes not call removeById if an appointment is already expired for long enough", async () => {
        const watcher = new Watcher(
            responder,
            blockCache,
            store,
            CONFIRMATIONS_BEFORE_RESPONSE,
            CONFIRMATIONS_BEFORE_REMOVAL
        );

        await watcher.handleChanges(
            {
                items: makeMap(appointment.id, {
                    state: WatcherAppointmentState.WATCHING
                }),
                blockNumber: 101 + CONFIRMATIONS_BEFORE_REMOVAL
            },
            {
                items: makeMap(appointment.id, {
                    state: WatcherAppointmentState.WATCHING
                }),
                blockNumber: 101 + CONFIRMATIONS_BEFORE_REMOVAL + 1
            }
        );

        verify(mockedStore.removeById(appointment.id)).never();
    });
});
