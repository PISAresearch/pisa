import "mocha";
import {
    BlockchainMachineService,
    CachedKeyValueStore,
    BlockItemStore,
    Component,
    IBlockStub,
    StateReducer,
    BlockProcessor,
    BlockCache,
    BlockProcessorStore
} from "../src";
import levelup, { LevelUp } from "levelup";
import EncodingDown from "encoding-down";
import MemDown from "memdown";
import Ganache from "ganache-core";
import { ethers } from "ethers";
import { StartStopService, defaultSerialiser, PlainObjectOrSerialisable, PlainObject } from "@pisa-research/utils";
import { Web3Provider } from "ethers/providers";
import { wait } from "@pisa-research/test-utils";
import { expect } from "chai";

/**
 *
 * @param provider
 * @param noOfBlocks
 * @param offset Add an offset to ensure block hashes are different
 */
export async function mine(provider: Web3Provider, noOfBlocks: number, offset: number = 0) {
    for (let i = 0; i < noOfBlocks; i++) {
        // sometime we get the following error:
        // Uncaught Error: Number can only safely store up to 53 bits
        // which is thrown down in ganache, in the past we solved this by minusing a large number
        // from Date.now(), but then that started failing. For some reason just doing Date.now() works at the
        // moment. We used to have Date.now() - 1574116236656
        // https://github.com/trufflesuite/ganache-cli#custom-methods
        await provider.send("evm_mine", Math.floor(Date.now() / 1000) + offset);
        // apparently this seems to help to force ganache to wait until the block is actually mined
        if (!(await provider.getBlock(await provider.getBlockNumber()))) throw new Error("Block not mined.");
    }
}

type BlockHistoryState = {
    blockNumber: number;
    allBlockNumbers: number[];
} & PlainObject;
type BlockNumberAction = {
    prevBlockNumber: number;
    prevAllBlockNumbers: number[];
    currentBlockNumber: number;
    currentAllBlockNumbers: number[];
} & PlainObject;

const calculateActionsForPrevBlock = (fromBlock: number, currentBlockNumber: number): BlockNumberAction => {
    const prevAllBlockNumbers = new Array(currentBlockNumber - fromBlock).fill(0).map((_, i) => fromBlock + i);
    return {
        prevBlockNumber: fromBlock === currentBlockNumber ? 0 : currentBlockNumber - 1,
        prevAllBlockNumbers: prevAllBlockNumbers,
        currentBlockNumber: currentBlockNumber,
        currentAllBlockNumbers: [...prevAllBlockNumbers, currentBlockNumber]
    };
};

const calculateActionsTakenBetweenBlocksInclusive = (fromBlock: number, blockNumberA: number, blockNumberB: number) => {
    const actions: BlockNumberAction[] = [];
    for (let index = blockNumberA; index <= blockNumberB; index++) {
        actions.push(calculateActionsForPrevBlock(fromBlock, index));
    }
    return actions;
};

class BlockNumberReducer implements StateReducer<BlockHistoryState, IBlockStub> {
    public async getInitialState() {
        return {
            blockNumber: 0,
            allBlockNumbers: []
        };
    }

    public async reduce(state: BlockHistoryState, block: IBlockStub) {
        return {
            blockNumber: block.number,
            allBlockNumbers: [...state.allBlockNumbers, block.number]
        };
    }
}

class BlockNumberRecorderComponent extends Component<BlockHistoryState, IBlockStub, BlockNumberAction> {
    public readonly actionsTaken: BlockNumberAction[] = [];

    public readonly name = "block-number-reducer";

    constructor() {
        super(new BlockNumberReducer());
    }

    public detectChanges(prevState: BlockHistoryState, currentState: BlockHistoryState) {
        return [
            {
                prevBlockNumber: prevState.blockNumber,
                prevAllBlockNumbers: prevState.allBlockNumbers,
                currentBlockNumber: currentState.blockNumber,
                currentAllBlockNumbers: currentState.allBlockNumbers
            }
        ];
    }

    public async applyAction(action: BlockNumberAction) {
        this.actionsTaken.push(action);
    }
}

const mineBlocksInCache = (blockCache: BlockCache<IBlockStub>, provider: Web3Provider) => async (num: number, offset?: number) => {
    const currentHead = await provider.getBlockNumber();
    await mine(provider, num, offset);

    await new Promise(async (resolve, _) => {
        do {
            const headNow = blockCache.head.number;
            if (headNow - currentHead === num) {
                resolve();
                break;
            } else await wait(10);
        } while (true);
    });
};

describe("BlockchainMachineIntegration", () => {
    const startBlockchainMachine = async (db?: LevelUp<EncodingDown<string, any>>, pollingInterval?: number, provider?: Web3Provider) => {
        db =
            db ||
            levelup(
                EncodingDown<string, any>(MemDown(), { valueEncoding: "json" })
            );

        const actionStore = new CachedKeyValueStore<BlockNumberAction>(db, defaultSerialiser, "blockchain-machine-actions-store");
        const blockItemStore = new BlockItemStore(db, defaultSerialiser);

        let startBlockNumber = 2;
        let mineFirstBlock = false;
        if (!provider) {
            const ganache = Ganache.provider();
            provider = new ethers.providers.Web3Provider(ganache as any);
            await provider.send("miner_stop", []);
            // start on block startBlockNumber - 1; an extra block will be mined after strarting the services
            await mine(provider, startBlockNumber - 1);
            mineFirstBlock = true;
        }
        provider.pollingInterval = pollingInterval || 10;

        const blockCacheDepth = 10;
        const blockCache = new BlockCache(blockCacheDepth, blockItemStore);

        const blockProcessorStore = new BlockProcessorStore(db);
        const blockProcessor = new BlockProcessor(
            provider,
            provider => async (blockHashOrNumber: string | number) => {
                const block = await provider.getBlock(blockHashOrNumber);
                return {
                    number: block.number,
                    parentHash: block.parentHash,
                    hash: block.hash
                };
            },
            blockCache,
            blockItemStore,
            blockProcessorStore
        );

        const blockNumberRecorderComponent = new BlockNumberRecorderComponent();

        const blockchainMachine = new BlockchainMachineService(blockProcessor, actionStore, blockItemStore, [blockNumberRecorderComponent]);

        await blockItemStore.start();
        await actionStore.start();
        await blockchainMachine.start();
        await blockProcessor.start();

        if (mineFirstBlock) await mine(provider, 1);

        startBlockNumber = await provider.getBlockNumber();

        return {
            db,
            services: [blockItemStore, actionStore, blockchainMachine, blockProcessor],
            mineBlocks: mineBlocksInCache(blockCache, provider),
            blockCache,
            actionsTaken: blockNumberRecorderComponent.actionsTaken,
            blockCacheDepth,
            startBlockNumber,
            provider
        };
    };

    const stopBlockchainMachine = async (services: StartStopService[]) => {
        await Promise.all(services.reverse().map(a => a.stop()));
    };

    const startMineBlocksStop = async (
        blocksToMine: number,
        dbIn?: LevelUp<EncodingDown<string, any>>,
        providerIn?: Web3Provider,
        fromBlock?: number,
        startUpBlock?: number
    ) => {
        const { services, mineBlocks: mineBlocks, blockCache, actionsTaken, startBlockNumber, db, provider } = await startBlockchainMachine(
            dbIn,
            undefined,
            providerIn
        );

        expect(blockCache.head.number, "head number matches before").to.eq(startUpBlock || startBlockNumber);
        await mineBlocks(blocksToMine);
        expect(blockCache.head.number, "head number matches after").to.eq(startBlockNumber + blocksToMine);

        // console.log(actionsTaken);
        // console.log(fromBlock || startBlockNumber, startUpBlock || startBlockNumber, startBlockNumber + blocksToMine);
        // console.log(
        //     calculateActionsTakenBetweenBlocksInclusive(fromBlock || startBlockNumber, startUpBlock + 1 || startBlockNumber, startBlockNumber + blocksToMine)
        // );

        expect(actionsTaken, "invalid actions taken").to.deep.eq(
            calculateActionsTakenBetweenBlocksInclusive(fromBlock || startBlockNumber, startUpBlock + 1 || startBlockNumber, startBlockNumber + blocksToMine)
        );

        await stopBlockchainMachine(services);
        return { db, provider, actionsTaken, startBlockNumber };
    };

    it("does startup and process a block", async () => {
        await startMineBlocksStop(1);
    });

    it("does startup and process many blocks", async () => {
        await startMineBlocksStop(5);
    });

    it("does startup and process many more blocks that cache depth", async () => {
        await startMineBlocksStop(25);
    });

    it("does detect intermediary blocks", async () => {
        // set a low polling interval so that we're sure many blocks get process in one go
        const { services, mineBlocks, blockCache, actionsTaken, startBlockNumber } = await startBlockchainMachine(undefined, 400);

        const blocksToMine = 30;
        expect(blockCache.head.number).to.eq(startBlockNumber);
        await mineBlocks(blocksToMine / 2);
        // wait to ensure we mine in at least two separate head events
        await wait(500);
        await mineBlocks(blocksToMine / 2);

        expect(blockCache.head.number).to.eq(startBlockNumber + blocksToMine);
        expect(actionsTaken, "invalid actions").to.deep.eq(
            calculateActionsTakenBetweenBlocksInclusive(startBlockNumber, startBlockNumber, startBlockNumber + blocksToMine)
        );

        await stopBlockchainMachine(services);
    });

    it("start, stop does detect all correct blocks", async () => {
        const { db, provider, actionsTaken: actionsTaken1, startBlockNumber } = await startMineBlocksStop(2);

        const { actionsTaken: actionsTaken2 } = await startMineBlocksStop(2, db, provider, startBlockNumber, startBlockNumber + 2);

        expect(actionsTaken1.concat(actionsTaken2), "invalid actions after restart").to.deep.eq(
            calculateActionsTakenBetweenBlocksInclusive(startBlockNumber, startBlockNumber, startBlockNumber + 4)
        );
    }).timeout(5000);

    it("start, stop and gap does detect all correct blocks", async () => {
        const { db, provider, actionsTaken: actionsTaken1, startBlockNumber } = await startMineBlocksStop(2);
        await mine(provider, 5);
        const { actionsTaken: actionsTaken2 } = await startMineBlocksStop(2, db, provider, startBlockNumber, startBlockNumber + 2);

        expect(actionsTaken1.concat(actionsTaken2)).to.deep.eq(
            calculateActionsTakenBetweenBlocksInclusive(startBlockNumber, startBlockNumber, startBlockNumber + 9)
        );
    }).timeout(5000);

    it("start, stop and gap greater than block cache depth does detect all correct blocks", async () => {
        const { db, provider, actionsTaken: actionsTaken1, startBlockNumber } = await startMineBlocksStop(2);
        await mine(provider, 25);
        const { actionsTaken: actionsTaken2 } = await startMineBlocksStop(2, db, provider, startBlockNumber, startBlockNumber + 2);

        expect(actionsTaken1.concat(actionsTaken2), "invalid actions").to.deep.eq(
            calculateActionsTakenBetweenBlocksInclusive(startBlockNumber, startBlockNumber, startBlockNumber + 29)
        );
    }).timeout(5000);

    it("start, reorg, does detect new blocks", async () => {
        const { services, mineBlocks: mineBlocks, blockCache, actionsTaken, startBlockNumber, db, provider } = await startBlockchainMachine();
        const blocksToMine = 2;

        // mine the first set of blocks
        expect(blockCache.head.number).to.eq(startBlockNumber);
        await mineBlocks(blocksToMine);
        expect(blockCache.head.number).to.eq(startBlockNumber + blocksToMine);
        expect(actionsTaken).to.deep.eq(calculateActionsTakenBetweenBlocksInclusive(startBlockNumber, startBlockNumber, startBlockNumber + blocksToMine));

        // take a snap shot of ganache
        let snapShotId = await provider.send("evm_snapshot", []);

        // clear the actions and mine some more blocks
        actionsTaken.splice(0, actionsTaken.length);

        // mine the second set of blocks
        const snapshotStarterBlockNumber = startBlockNumber + blocksToMine;
        expect(blockCache.head.number).to.eq(snapshotStarterBlockNumber);
        await mineBlocks(blocksToMine, 1);
        expect(blockCache.head.number).to.eq(snapshotStarterBlockNumber + blocksToMine);
        expect(actionsTaken, "second actions invalid").to.deep.eq(
            calculateActionsTakenBetweenBlocksInclusive(startBlockNumber, snapshotStarterBlockNumber + 1, snapshotStarterBlockNumber + blocksToMine)
        );

        // now revert and reset the snap shot id
        await provider.send("evm_revert", [snapShotId]);
        const reorgBlocksToMine = blocksToMine + 1;

        // cler the actions again
        actionsTaken.splice(0, actionsTaken.length);

        // mine the second set of blocks
        expect(blockCache.head.number).to.eq(snapshotStarterBlockNumber + blocksToMine);
        await mineBlocks(reorgBlocksToMine, 2);
        expect(blockCache.head.number).to.eq(snapshotStarterBlockNumber + reorgBlocksToMine);
        expect(actionsTaken, "third actions invalid").to.deep.eq(
            calculateActionsTakenBetweenBlocksInclusive(startBlockNumber, snapshotStarterBlockNumber + 1, snapshotStarterBlockNumber + reorgBlocksToMine)
        );

        await stopBlockchainMachine(services);
        return { db, provider, actionsTaken, startBlockNumber };
    }).timeout(5000);
});
