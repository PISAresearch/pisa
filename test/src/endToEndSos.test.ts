import "mocha";
import request from "request-promise";
import * as SosContract from "./../smoke/SOSContract";
import { Wallet, ethers } from "ethers";
import levelup from "levelup";
import MemDown from "memdown";
import encodingDown from "encoding-down";
import config from "../../src/dataEntities/config";
import Ganache from "ganache-core";
import { Appointment, IAppointmentRequest } from "../../src/dataEntities";
import { PisaService } from "../../src/service";
import { wait } from "../../src/utils";
const ganache = Ganache.provider({
    mnemonic: "myth like bonus scare over problem client lizard pioneer submit female collect"
});
const userPrivKey = "0x829e924fdf021ba3dbbc4225edfece9aca04b929d6e75613329ca6f1d31c0bb4";

const nextConfig = {
    ...config,
    hostName: "localhost",
    hostPort: 3010,
    jsonRpcUrl: "http://localhost:8545",
    responderKey: "0x6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c",
    receiptKey: "0x6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c",
    watcherResponseConfirmations: 0
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
            endBlock: startBlock + 30,
            eventABI: eventAbi,
            eventArgs: eventArgs,
            gasLimit: "100000",
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

    const createRescueRequest = async (
        rescueContract: ethers.Contract,
        provider: ethers.providers.BaseProvider,
        user: ethers.Wallet,
        appointmentId: number,
        message: string
    ) => {
        // setup
        const startBlock = await provider.getBlockNumber();
        const jobId = 1;
        const appointmentRequest = createAppointmentRequest(
            rescueContract.address,
            user.address,
            SosContract.encodeData(message),
            SosContract.DISTRESS_EVENT_ABI,
            SosContract.encodeArgs(message),
            appointmentId,
            jobId,
            startBlock
        );
        // encode the request and sign it
        const appointment = Appointment.fromIAppointmentRequest(appointmentRequest);
        const encoded = appointment.encode();
        const customerSig = await user.signMessage(ethers.utils.arrayify(encoded));
        return {
            ...appointmentRequest,
            customerSig: customerSig
        };
    };

    const callDistressAndWaitForRescue = async (
        rescueContract: ethers.Contract,
        user: ethers.Wallet,
        rescueMessage: string,
        appointmentId: number
    ) => {
        const rescueRequest1 = await createRescueRequest(rescueContract, provider, user, appointmentId, rescueMessage);

        
        const response = await request.post(`http://${nextConfig.hostName}:${nextConfig.hostPort}/appointment`, {
            json: rescueRequest1
        });

        let success = false;
        rescueContract.once(SosContract.RESCUE_EVENT_METHOD_SIGNATURE, () => (success = true));
        const tx = await rescueContract.help(rescueMessage);
        await tx.wait(2);

        await mineBlocks(10, user);

        
        await waitForPredicate(() => success, 50, 20, rescueMessage);
        console.log(`${rescueMessage} rescued!`);
    };

    it("two of the same appointment back to back, 10 blocks apart", async () => {
        const responderWallet = new ethers.Wallet(nextConfig.responderKey, provider);
        const db = levelup(
            encodingDown<string, any>(MemDown(), {
                valueEncoding: "json"
            })
        );
        const user = new Wallet(userPrivKey, provider);
        const nonce = await responderWallet.getTransactionCount();
        const exService = new PisaService(
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
        const channelContractFactory = new ethers.ContractFactory(SosContract.ABI, SosContract.ByteCode, user);
        const rescueContract = await channelContractFactory.deploy();

        await callDistressAndWaitForRescue(rescueContract, user, "sos", 1);
        await callDistressAndWaitForRescue(rescueContract, user, "sos", 2);

        await exService.stop();

        // now go again
    }).timeout(30000);
});

const waitForPredicate = (predicate: () => boolean, interval: number, repetitions: number, message: string) => {
    return new Promise((resolve, reject) => {
        const intervalHandle = setInterval(() => {
            if (predicate()) {
                resolve();
                clearInterval(intervalHandle);
            } else if (--repetitions <= 0) {
                reject(new Error(message));
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
