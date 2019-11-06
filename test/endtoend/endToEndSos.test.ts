import "mocha";
import * as SosContract from "../smoke/SOSContract";
import { Wallet, ethers } from "ethers";
import levelup, { LevelUp } from "levelup";
import MemDown from "memdown";
import encodingDown from "encoding-down";
import config from "../../packages/server/src/service/config";
import Ganache from "ganache-core";
import { PisaService } from "../../packages/server/src/service/service";
import { wait } from "../../packages/test-utils/src";
import { BigNumber, arrayify } from "ethers/utils";
import { expect } from "chai";
import { deployPisa } from "../../packages/server/__tests__/utils/contract";
import PisaClient from "../../packages/client";
import { encodeTopicsForPisa } from "../../packages/server/src/utils/ethers";
const ganache = Ganache.provider({
    mnemonic: "myth like bonus scare over problem client lizard pioneer submit female collect",
    gasLimit: 8000000
}) as Ganache.Provider & ethers.providers.AsyncSendable;
const userKey1 = "0x829e924fdf021ba3dbbc4225edfece9aca04b929d6e75613329ca6f1d31c0bb4";
const userKey2 = "0x67950d009c30c78d1cc65d8427abcdd09195e358810be9ed40512a1e3ec9d83d";

const nextConfig = {
    ...config,
    hostName: "localhost",
    hostPort: 3010,
    jsonRpcUrl: "http://localhost:8545",
    responderKey: "0x6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c",
    receiptKey: "0x6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c",
    watcherResponseConfirmations: 0,
    maximumReorgLimit: 10
};
const provider = new ethers.providers.Web3Provider(ganache);
provider.pollingInterval = 100;

describe("sos end to end", () => {
    const getAppointmentForMessage = async (
        pisaContractAddress: string,
        user: ethers.Wallet,
        helpMessage: string,
        rescueMessage: string,
        appointmentId: string
    ) => {
        // setup
        const startBlock = await provider.getBlockNumber();
        const nonce = 1;

        const iFace = new ethers.utils.Interface(SosContract.ABI);
        const topics = iFace.events["Distress"].encodeTopics([helpMessage]);

        const pisaClient = new PisaClient(`http://${nextConfig.hostName}:${nextConfig.hostPort}`, pisaContractAddress);
        return await pisaClient.generateAndExecuteRequest(
            digest => user.signMessage(arrayify(digest)),
            user.address,
            appointmentId,
            nonce,
            startBlock,
            startBlock + 200,
            rescueContract.address,
            SosContract.encodeData(rescueMessage),
            100000,
            100,
            rescueContract.address,
            topics
        );
    };

    const callDistressAndWaitForRescue = async (
        rescueContract: ethers.Contract,
        helpMessage: string,
        errorMessage: string
    ) => {
        let success = false;
        rescueContract.once(SosContract.RESCUE_EVENT_METHOD_SIGNATURE, () => (success = true));
        const tx = await rescueContract.help(helpMessage, { gasLimit: 1000000 });
        await tx.wait();
        await waitForPredicate(() => success, 10, 1000, helpMessage + ":" + errorMessage);
    };

    const callDistressAndWaitForCounter = async (helpMessage: string, count: number) => {
        const tx = await rescueContract.help(helpMessage);
        await tx.wait();
        await waitForPredicate(
            async () => ((await rescueContract.rescueCount()) as BigNumber).eq(count),
            500,
            20,
            async () => `Count ${(await rescueContract.rescueCount()).toNumber()} is not expected value ${count}.`
        );
    };

    let db: LevelUp<encodingDown<string, any>>,
        exService: PisaService,
        user1: ethers.Wallet,
        user2: ethers.Wallet,
        rescueContract: ethers.Contract,
        responderWallet: ethers.Wallet,
        pisaContractAddress: string;

    beforeEach(async () => {
        db = levelup(
            encodingDown<string, any>(MemDown(), {
                valueEncoding: "json"
            })
        );
        responderWallet = new ethers.Wallet(nextConfig.responderKey, provider);
        user1 = new Wallet(userKey1, provider);
        user2 = new Wallet(userKey2, provider);
        const pisaContract = await deployPisa(responderWallet);
        pisaContractAddress = pisaContract.address;
        nextConfig.pisaContractAddress = pisaContractAddress;

        const nonce = await responderWallet.getTransactionCount();
        exService = new PisaService(
            nextConfig,
            provider,
            responderWallet,
            nonce,
            provider.network.chainId,
            responderWallet,
            db
        );
        await exService.start();

        // deploy the contract
        const sosContractFactory = new ethers.ContractFactory(SosContract.ABI, SosContract.ByteCode, user1);
        rescueContract = await sosContractFactory.deploy();
        // for some reason a wait is required here - perhaps to allow some time for the contract to deploy?
        await wait(150);
    });

    afterEach(async () => {
        await exService.stop();
    });

    it("setup pisa and call sos", async () => {
        const pisaContract = await deployPisa(responderWallet);
        const helpMessage = "sos";
        const rescueMessage = "yay";
        const appointmentId = "0x0000000000000000000000000000000000000000000000000000000000000001";

        // setup
        const startBlock = await provider.getBlockNumber();
        const nonce = 1;

        const iFace = new ethers.utils.Interface(SosContract.ABI);
        const topics = iFace.events["Distress"].encodeTopics([helpMessage]);

        const pisaClient = new PisaClient(`http://${nextConfig.hostName}:${nextConfig.hostPort}`, pisaContract.address);
        const appointment = await pisaClient.generateRequest(
            (digest: string) => user1.signMessage(arrayify(digest)),
            user1.address,
            appointmentId,
            nonce,
            startBlock,
            startBlock + 200,
            rescueContract.address,
            SosContract.encodeData(rescueMessage),
            100000,
            100,
            rescueContract.address,
            topics
        );

        await pisaContract.respond(
            [
                appointment.contractAddress,
                appointment.customerAddress,
                appointment.startBlock,
                appointment.endBlock,
                appointment.challengePeriod,
                appointment.id,
                appointment.nonce,
                appointment.data,
                appointment.refund,
                appointment.gasLimit,
                appointment.mode,
                appointment.eventAddress,
                encodeTopicsForPisa(appointment.topics),
                appointment.preCondition,
                appointment.postCondition,
                appointment.paymentHash
            ],
            appointment.customerSig,
            { gasLimit: appointment.gasLimit + 2000000 }
        );
        

        const rescueCount: BigNumber = await rescueContract.rescueCount();
        expect(rescueCount.toNumber()).to.equal(1);
    });

    it("two of the same appointment back to back", async () => {
        await getAppointmentForMessage(
            pisaContractAddress,
            user1,
            "sos",
            "yay",
            "0x0000000000000000000000000000000000000000000000000000000000000001"
        );
        
        await callDistressAndWaitForRescue(rescueContract, "sos", "Failed 1");

        await getAppointmentForMessage(
            pisaContractAddress,
            user1,
            "sos",
            "yay",
            "0x0000000000000000000000000000000000000000000000000000000000000002"
        );
        await callDistressAndWaitForRescue(rescueContract, "sos", "Failed 2");
    }).timeout(30000);

    it("two of the same appointment from different customers back to back", async () => {
        await getAppointmentForMessage(
            pisaContractAddress,
            user1,
            "sos",
            "yay",
            "0x0000000000000000000000000000000000000000000000000000000000000001"
        );
        await callDistressAndWaitForRescue(rescueContract, "sos", "Failed 1");

        await getAppointmentForMessage(
            pisaContractAddress,
            user2,
            "sos",
            "yay",
            "0x0000000000000000000000000000000000000000000000000000000000000001"
        );
        await callDistressAndWaitForRescue(rescueContract, "sos", "Failed 2");
    }).timeout(30000);

    it("two different appointments back to back", async () => {
        await getAppointmentForMessage(
            pisaContractAddress,
            user1,
            "sos",
            "yay1",
            "0x0000000000000000000000000000000000000000000000000000000000000001"
        );
        await callDistressAndWaitForRescue(rescueContract, "sos", "Failed 1");

        await getAppointmentForMessage(
            pisaContractAddress,
            user2,
            "sos",
            "yay2",
            "0x0000000000000000000000000000000000000000000000000000000000000001"
        );
        await callDistressAndWaitForRescue(rescueContract, "sos", "Failed 2");
    }).timeout(30000);

    it("two different appointments at the same time same users", async () => {
        await getAppointmentForMessage(
            pisaContractAddress,
            user1,
            "sos",
            "yay1",
            "0x0000000000000000000000000000000000000000000000000000000000000001"
        );
        await getAppointmentForMessage(
            pisaContractAddress,
            user1,
            "sos",
            "yay2",
            "0x0000000000000000000000000000000000000000000000000000000000000002"
        );

        await callDistressAndWaitForCounter("sos", 2);
    }).timeout(30000);

    it("two same appointments at the same time same users", async () => {
        await getAppointmentForMessage(
            pisaContractAddress,
            user1,
            "sos",
            "yay1",
            "0x0000000000000000000000000000000000000000000000000000000000000001"
        );
        await getAppointmentForMessage(
            pisaContractAddress,
            user1,
            "sos",
            "yay1",
            "0x0000000000000000000000000000000000000000000000000000000000000002"
        );

        await callDistressAndWaitForCounter("sos", 2);
    }).timeout(30000);

    it("two same appointments at the same time different users", async () => {
        await getAppointmentForMessage(
            pisaContractAddress,
            user1,
            "sos",
            "yay1",
            "0x0000000000000000000000000000000000000000000000000000000000000001"
        );
        await getAppointmentForMessage(
            pisaContractAddress,
            user2,
            "sos",
            "yay1",
            "0x0000000000000000000000000000000000000000000000000000000000000001"
        );

        await callDistressAndWaitForCounter("sos", 2);
    }).timeout(30000);

    it("PISA should respond again if there is a reorg after the responder confirmation time", async () => {
        await getAppointmentForMessage(
            pisaContractAddress,
            user1,
            "sos",
            "yay1",
            "0x0000000000000000000000000000000000000000000000000000000000000001"
        );
        const snapshotId: number = await promiseSendAsync(ganache, { method: "evm_snapshot" });
        await callDistressAndWaitForCounter("sos", 1);
        await promiseSendAsync(ganache, { method: "evm_revert", params: snapshotId });
        // ensure that the revert occurred well
        expect((await rescueContract.rescueCount()).toNumber()).to.equal(0);

        // mine some blocks to give pisa a chance to respond
        await mineBlocks(10, user1);

        expect((await rescueContract.rescueCount()).toNumber()).to.equal(1);
    }).timeout(5000);
});

const promiseSendAsync = (ganache: ethers.providers.AsyncSendable, options: any): any => {
    return new Promise((resolve, reject) => {
        ganache.sendAsync!({ jsonppc: "2.0", ...options }, (err: any, result: any) => {
            if (err) reject(err);
            else resolve(result.result);
        });
    });
};

const waitForPredicate = (
    predicate: () => Promise<boolean> | boolean,
    interval: number,
    repetitions: number,
    message: string | (() => Promise<string>)
) => {
    return new Promise((resolve, reject) => {
        const intervalHandle = setInterval(async () => {
            const predResult = await predicate();
            if (predResult) {
                resolve();
                clearInterval(intervalHandle);
            } else if (--repetitions <= 0) {
                if (message.length) reject(new Error(message as string));
                else reject(new Error(await (message as () => Promise<string>)()));
            }
        }, interval);
    });
};

const mineBlocks = async (count: number, signer: ethers.Signer) => {
    for (let i = 0; i < count; i++) {
        await mineBlock(signer);
    }
};

const mineBlock = async (signer: ethers.Signer) => {
    const tx = await signer.sendTransaction({ to: "0x0000000000000000000000000000000000000000", value: 0 });
    await tx.wait();
};
