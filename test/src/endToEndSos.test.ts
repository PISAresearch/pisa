import "mocha";
import request from "request-promise";
import * as SosContract from "./../smoke/SOSContract";
import { Wallet, ethers } from "ethers";
import levelup, { LevelUp } from "levelup";
import MemDown from "memdown";
import encodingDown from "encoding-down";
import config from "../../src/dataEntities/config";
import Ganache from "ganache-core";
import { Appointment, IAppointmentRequest } from "../../src/dataEntities";
import { PisaService } from "../../src/service";
import { wait } from "../../src/utils";
import { BigNumber, keccak256, arrayify, defaultAbiCoder } from "ethers/utils";
import { expect } from "chai";
import { deployPisa } from "./utils/contract";
const ganache = Ganache.provider({
    mnemonic: "myth like bonus scare over problem client lizard pioneer submit female collect",
    gasLimit: 8000000
});
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
    const createAppointmentRequest = (
        contractAddress: string,
        customerAddress: string,
        data: string,
        eventAbi: string,
        eventArgs: string,
        id: number,
        jobId: number,
        startBlock: number
    ): IAppointmentRequest => {
        return {
            challengePeriod: 100,
            contractAddress,
            customerAddress: customerAddress,
            data,
            endBlock: startBlock + 200,
            eventABI: eventAbi,
            eventArgs: eventArgs,
            gasLimit: 100000,
            id,
            jobId,
            mode: 1,
            preCondition: "0x",
            postCondition: "0x",
            refund: "0",
            startBlock,
            paymentHash: "0xfc1624bdc50da30f2ea37b7debabeac1f6166db013c5880dcf63907b04199138",
            customerSig: "dummy"
        };
    };

    const createRescueRequestAppointment = async (
        rescueContract: ethers.Contract,
        pisaContractAddress: string,
        provider: ethers.providers.BaseProvider,
        user: ethers.Wallet,
        appointmentId: number,
        helpMessage: string,
        rescueMessage: string
    ) => {
        // setup
        const startBlock = await provider.getBlockNumber();
        const jobId = 1;
        const appointmentRequest = createAppointmentRequest(
            rescueContract.address,
            user.address,
            SosContract.encodeData(rescueMessage),
            SosContract.DISTRESS_EVENT_ABI,
            SosContract.encodeArgs(helpMessage),
            appointmentId,
            jobId,
            startBlock
        );
        // encode the request and sign it
        const appointment = Appointment.fromIAppointmentRequest(appointmentRequest);
        const encoded = appointment.encode();
        const hashedWithAddress = keccak256(
            defaultAbiCoder.encode(["bytes", "address"], [encoded, pisaContractAddress])
        );
        const customerSig = await user.signMessage(arrayify(hashedWithAddress));

        return Appointment.fromIAppointmentRequest({
            ...appointmentRequest,
            customerSig: customerSig
        });
    };

    const getAppointmentForMessage = async (
        pisaContractAddress: string,
        user: ethers.Wallet,
        helpMessage: string,
        rescueMessage: string,
        appointmentId: number
    ) => {
        const rescueRequest1 = await createRescueRequestAppointment(
            rescueContract,
            pisaContractAddress,
            provider,
            user,
            appointmentId,
            helpMessage,
            rescueMessage
        );

        return await request.post(`http://${nextConfig.hostName}:${nextConfig.hostPort}/appointment`, {
            json: Appointment.toIAppointmentRequest(rescueRequest1)
        });
    };

    const callDistressAndWaitForRescue = async (
        rescueContract: ethers.Contract,
        helpMessage: string,
        errorMessage: string
    ) => {
        let success = false;
        rescueContract.once(SosContract.RESCUE_EVENT_METHOD_SIGNATURE, () => (success = true));
        await wait(50);
        const tx = await rescueContract.help(helpMessage, { gasLimit: 1000000 });
        await wait(50);
        await tx.wait();

        await waitForPredicate(() => success, 50, 20, helpMessage + ":" + errorMessage);
    };

    const callDistressAndWaitForCounter = async (helpMessage: string, count: number) => {
        await wait(50);
        const tx = await rescueContract.help(helpMessage);
        await wait(50);
        await tx.wait();
        await waitForPredicate(
            async () => ((await rescueContract.rescueCount()) as BigNumber).eq(count),
            50,
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
    });

    afterEach(async () => {
        await exService.stop();
    });

    it("setup pisa and call sos", async () => {
        const pisaContract = await deployPisa(responderWallet);
        const appointment = await createRescueRequestAppointment(
            rescueContract,
            pisaContract.address,
            provider,
            user1,
            1,
            "sos",
            "yay"
        );
        await pisaContract.respond(appointment.encode(), appointment.customerSig, {
            gasLimit: appointment.gasLimit + 200000
        });

        const rescueCount: BigNumber = await rescueContract.rescueCount();
        expect(rescueCount.toNumber()).to.equal(1);
    });

    it("two of the same appointment back to back", async () => {
        await getAppointmentForMessage(pisaContractAddress, user1, "sos", "yay", 1);
        await callDistressAndWaitForRescue(rescueContract, "sos", "Failed 1");

        await getAppointmentForMessage(pisaContractAddress, user1, "sos", "yay", 2);
        await callDistressAndWaitForRescue(rescueContract, "sos", "Failed 2");
    }).timeout(30000);

    it("two of the same appointment from different customers back to back", async () => {
        await getAppointmentForMessage(pisaContractAddress, user1, "sos", "yay", 1);
        await callDistressAndWaitForRescue(rescueContract, "sos", "Failed 1");

        await getAppointmentForMessage(pisaContractAddress, user2, "sos", "yay", 1);
        await callDistressAndWaitForRescue(rescueContract, "sos", "Failed 2");
    }).timeout(30000);

    it("two different appointments back to back", async () => {
        await getAppointmentForMessage(pisaContractAddress, user1, "sos", "yay1", 1);
        await callDistressAndWaitForRescue(rescueContract, "sos", "Failed 1");

        await getAppointmentForMessage(pisaContractAddress, user2, "sos", "yay2", 1);
        await callDistressAndWaitForRescue(rescueContract, "sos", "Failed 2");
    }).timeout(30000);

    it("two different appointments at the same time same users", async () => {
        await getAppointmentForMessage(pisaContractAddress, user1, "sos", "yay1", 1);
        await getAppointmentForMessage(pisaContractAddress, user1, "sos", "yay2", 2);

        await callDistressAndWaitForCounter("sos", 2);
    }).timeout(30000);

    it("two same appointments at the same time same users", async () => {
        await getAppointmentForMessage(pisaContractAddress, user1, "sos", "yay1", 1);
        await getAppointmentForMessage(pisaContractAddress, user1, "sos", "yay1", 2);

        await callDistressAndWaitForCounter("sos", 2);
    }).timeout(30000);

    it("two same appointments at the same time different users", async () => {
        await getAppointmentForMessage(pisaContractAddress, user1, "sos", "yay1", 1);
        await getAppointmentForMessage(pisaContractAddress, user2, "sos", "yay1", 1);

        await callDistressAndWaitForCounter("sos", 2);
    }).timeout(30000);
});

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
