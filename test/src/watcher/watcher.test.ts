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
    Block,
    ApplicationError,
    IEthereumAppointment
} from "../../../src/dataEntities";
import {
    WatcherAppointmentStateReducer,
    WatcherAppointmentState,
    Watcher,
    WatcherAppointmentAnchorState
} from "../../../src/watcher/watcher";

const observedEventAddress = "0x1234abcd";
const observedEventTopics = ["0x1234"];

const blocks: Block[] = [
    {
        hash: "hash0",
        number: 0,
        parentHash: "hash",
        logs: [],
        transactionHashes: [],
        transactions: []
    },
    {
        hash: "hash1",
        number: 1,
        parentHash: "hash0",
        logs: [],

        transactionHashes: [],
        transactions: []
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
        ],
        transactionHashes: [],
        transactions: []
    },
    {
        hash: "hash3",
        number: 3,
        parentHash: "hash2",
        logs: [],
        transactionHashes: [],
        transactions: []
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

    const blockCache = new BlockCache<Block>(100);
    blocks.forEach(b => blockCache.addBlock(b));

    it("constructor throws ApplicationError if the topics are not set in the filter", () => {
        const mockAppointmentWithEmptyFilter = new MockAppointmentWithEmptyFilter(10, ChannelType.None, 0, 10);
        expect(() => new WatcherAppointmentStateReducer(blockCache, mockAppointmentWithEmptyFilter)).to.throw(
            ApplicationError
        );
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

    const blockCache = new BlockCache<Block>(100);
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
        when(mockedStore.getById(appointment.id)).thenReturn(appointment);
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

        verify(mockedResponder.startResponse(appointment.id, anything())).once();
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

        verify(mockedResponder.startResponse(appointment.id, anything())).never();
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

        verify(mockedResponder.startResponse(appointment.id, anything())).once();
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

        verify(mockedResponder.startResponse(appointment.id, anything())).never();
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
});
