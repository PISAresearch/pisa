import "mocha";
import { Watcher } from "../../src/watcher/watcher";
import { KitsuneTools } from "../external/kitsune/tools";
import { ethers } from "ethers";
import Ganache from "ganache-core";
import { GasPriceEstimator, MultiResponder, ResponderStore } from "../../src/responder";
import { Block, Appointment } from "../../src/dataEntities";
import { AppointmentStore } from "../../src/watcher/store";
import { wait } from "../../src/utils";
import { BlockProcessor, BlockCache, blockFactory } from "../../src/blockMonitor";
import levelup from "levelup";
import MemDown from "memdown";
import { BlockchainMachine } from "../../src/blockMonitor/blockchainMachine";
import encodingDown from "encoding-down";
import { GasQueue } from "../../src/responder/gasQueue";

const ganache = Ganache.provider({
    mnemonic: "myth like bonus scare over problem client lizard pioneer submit female collect"
});

describe("End to end", () => {
    let player0: string,
        player1: string,
        pisaAccount: string,
        hashState: string,
        sig0: string,
        sig1: string,
        data: string,
        channelContract: ethers.Contract,
        round: number,
        provider: ethers.providers.Web3Provider = new ethers.providers.Web3Provider(ganache),
        challengePeriod: number;

    before(async () => {
        provider.pollingInterval = 100;
        // set the 2 accounts
        const accounts = await provider.listAccounts();
        player0 = accounts[0];
        player1 = accounts[1];
        pisaAccount = accounts[2];

        // deploy the channel
        const channelContractFactory = new ethers.ContractFactory(
            KitsuneTools.ContractAbi,
            KitsuneTools.ContractBytecode,
            provider.getSigner(accounts[3])
        );
        challengePeriod = 11;
        channelContract = await channelContractFactory.deploy([player0, player1], challengePeriod);
        // set the round
        round = 1;
        // set the hash state
        hashState = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("hello"));
        // set the sigs
        const setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address);
        sig0 = await provider.getSigner(player0).signMessage(ethers.utils.arrayify(setStateHash));
        sig1 = await provider.getSigner(player1).signMessage(ethers.utils.arrayify(setStateHash));
        data = KitsuneTools.encodeSetStateData(hashState, round, sig0, sig1);
        //data = KitsuneTools.packData(hashState, round, sig0, sig1);
    });

    it("inspect and watch a contract", async () => {
        const appointment: Appointment = Appointment.fromIAppointment({
            challengePeriod,
            contractAddress: channelContract.address,
            customerAddress: player0,
            data,
            endBlock: 22,
            eventABI: KitsuneTools.eventABI(),
            eventArgs: KitsuneTools.eventArgs(),
            gasLimit: "100000",
            customerChosenId: 10,
            jobId: 0,
            mode: 1,
            preCondition: "0x",
            postCondition: "0x",
            refund: "0",
            startBlock: 0,
            paymentHash: "on-the-house",
            customerSig: "sig"
        });

        const blockCache = new BlockCache<Block>(200);
        const blockProcessor = new BlockProcessor<Block>(provider, blockFactory, blockCache);

        // 2. pass this appointment to the watcher
        const gasPriceEstimator = new GasPriceEstimator(provider, blockProcessor.blockCache);

        let db = levelup(encodingDown<string, any>(MemDown(), { valueEncoding: "json" }));
        const responderStore = new ResponderStore(db, pisaAccount, new GasQueue([], 0, 12, 13));
        const multiResponder = new MultiResponder(
            provider.getSigner(pisaAccount),
            gasPriceEstimator,
            provider.network.chainId,
            responderStore,
            pisaAccount,
            500000000000000000
        );

        const store = new AppointmentStore(db);

      await store.start();
        await store.addOrUpdateByLocator(appointment);
        const watcher = new Watcher(multiResponder, blockProcessor.blockCache, store, 0, 20);
        const player0Contract = channelContract.connect(provider.getSigner(player0));

        const blockchainMachine = new BlockchainMachine<Block>(blockProcessor);

        blockchainMachine.addComponent(watcher);
        await blockProcessor.start();
        // await store.start();
        await blockchainMachine.start();
        await responderStore.start();

        // 3. Trigger a dispute
        const tx = await player0Contract.triggerDispute();
        await tx.wait();

        await blockchainMachine.stop();
        await responderStore.stop();
        await store.stop();
        await blockProcessor.stop();
        await db.close();
        await wait(2000);
    }).timeout(3000);
});
