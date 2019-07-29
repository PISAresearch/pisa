import "mocha";
import { expect } from "chai";
import { mock, instance, when, resetCalls, verify, anything } from "ts-mockito";
import { AppointmentStore } from "../../../src/watcher";
import { ethers } from "ethers";
import { MultiResponder } from "../../../src/responder";
import { BlockCache } from "../../../src/blockMonitor";
import {
    EthereumAppointment,
    ChannelType,
    ApplicationError,
    IEthereumAppointment,
    IBlockStub,
    Logs
} from "../../../src/dataEntities";
import {
    WatcherAppointmentStateReducer,
    WatcherAppointmentState,
    Watcher,
    WatcherAppointmentAnchorState
} from "../../../src/watcher/watcher";
import {fnIt} from "../../../utils/fnIt";

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

// Mock of an appointment, in several tests
class MockAppointment extends EthereumAppointment {
    public getStateLocator(): string {
        throw new Error("Method not implemented.");
    }
    public getContractAbi() {
        return [];
    }
    public getContractAddress(): string {
        return "0xaaaabbbbccccdddd";
    }
    public getEventFilter(): ethers.EventFilter {
        return {
            address: observedEventAddress,
            topics: observedEventTopics
        };
    }
    public getEventName(): string {
        throw new Error("Method not implemented.");
    }
    public getStateNonce(): number {
        throw new Error("Method not implemented.");
    }
    public getResponseFunctionName(): string {
        return "responseFnName";
    }
    public getResponseFunctionArgs(): any[] {
        return [];
    }
}

class MockAppointmentWithEmptyFilter extends MockAppointment {
    public getEventFilter(): ethers.EventFilter {
        return {};
    }
}

describe("WatcherAppointmentStateReducer", () => {
    const appointment = new MockAppointment(10, ChannelType.None, 0, 100);

    const blockCache = new BlockCache<IBlockStub & Logs>(100);
    blocks.forEach(b => blockCache.addBlock(b));

    it("constructor throws ApplicationError if the topics are not set in the filter", () => {
        const mockAppointmentWithEmptyFilter = new MockAppointmentWithEmptyFilter(10, ChannelType.None, 0, 10);
        expect(() => new WatcherAppointmentStateReducer(blockCache, mockAppointmentWithEmptyFilter)).to.throw(
            ApplicationError
        );
    });

    fnIt<WatcherAppointmentStateReducer>(w => w.getInitialState, "initializes to WATCHING if event not present in ancestry", () =>{
        const asr = new WatcherAppointmentStateReducer(blockCache, appointment);

        expect(asr.getInitialState(blocks[1])).to.deep.equal({ state: WatcherAppointmentState.WATCHING });
    });

    fnIt<WatcherAppointmentStateReducer>(w => w.getInitialState, "initializes to OBSERVED if event is present in the last block", () =>{
        const asr = new WatcherAppointmentStateReducer(blockCache, appointment);
        expect(asr.getInitialState(blocks[2])).to.deep.equal({
            state: WatcherAppointmentState.OBSERVED,
            blockObserved: blocks[2].number
        });
    });

    fnIt<WatcherAppointmentStateReducer>(w => w.getInitialState, "initializes to OBSERVED if event is present in ancestry, updates blockObserved", () => {
        const asr = new WatcherAppointmentStateReducer(blockCache, appointment);
        expect(asr.getInitialState(blocks[3])).to.deep.equal({
            state: WatcherAppointmentState.OBSERVED,
            blockObserved: blocks[2].number
        });
    });

    fnIt<WatcherAppointmentStateReducer>(w => w.reduce, "does not change state if event is not observed in new block", () =>{
        const asr = new WatcherAppointmentStateReducer(blockCache, appointment);

        const result = asr.reduce(
            {
                state: WatcherAppointmentState.WATCHING
            },
            blocks[1]
        );

        expect(result).to.deep.equal({ state: WatcherAppointmentState.WATCHING });
    });

    fnIt<WatcherAppointmentStateReducer> (w => w.reduce,"does change state if event is observed in new block", () => {
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

    fnIt<WatcherAppointmentStateReducer>(w => w.reduce, "does not change from OBSERVED when new blocks come", () => {
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

    let appointment: IEthereumAppointment;

    beforeEach(() => {
        appointment = new MockAppointment(100, ChannelType.None, 0, 100);

        mockedStore = mock(AppointmentStore);
        when(mockedStore.getAll()).thenReturn([appointment]);
        const appointmentsById = new Map<string, IEthereumAppointment>();
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

    fnIt<Watcher>(w => w.handleChanges, "calls startResponse after event is OBSERVED for long enough", async() => {
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

    verify(mockedResponder.startResponse(appointment.id, anything())).once();
    });

    fnIt<Watcher>(w => w.handleChanges, "does not call startResponse before event is OBSERVED for long enough", async() => {
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

        verify(mockedResponder.startResponse(appointment.id, anything())).never();
    });

    fnIt<Watcher>(w => w.handleChanges, "calls startResponse immediately after event is OBSERVED for long enough even if just added to the store", async() => {
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
        verify(mockedResponder.startResponse(appointment.id, anything())).once();
    });

    fnIt<Watcher>(w => w.handleChanges,"does not call startResponse again if a previous state already caused startResponse", async() => {
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

        verify(mockedResponder.startResponse(appointment.id, anything())).never();
    });

    fnIt<Watcher>(w =>w.handleChanges, "calls removeById after event is OBSERVED for long enoug", async() => {
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

    fnIt<Watcher>(w => w.handleChanges, "does not call removeById before event is OBSERVED for long enough", async() => {
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

    fnIt<Watcher>(w => w.handleChanges, "calls removeById after an appointment has expired for long enough", async() => {
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

    fnIt<Watcher>(w => w.handleChanges, "dooes not call removeById before an appointment has expired for long enough", async() => {
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

    fnIt<Watcher>(w => w.handleChanges, "does not call removeById if an appointment is already expired for long enough", async() => {
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
