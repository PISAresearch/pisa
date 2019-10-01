import * as chai from "chai";
import "mocha";
import chaiAsPromised from "chai-as-promised";
import { KitsuneTools } from "../external/kitsune/tools";
import { ethers } from "ethers";
import { arrayify } from "ethers/utils";
import { PisaService } from "../../src/service";
import config from "../../src/dataEntities/config";
import Ganache from "ganache-core";
import levelup, { LevelUp } from "levelup";
import MemDown from "memdown";
import encodingDown from "encoding-down";
import { deployPisa } from "../src/utils/contract";
import { wait } from "../../src/utils";
import PisaClient from "../../client";
import expectAsync from "../utils/expectAsync";
chai.use(chaiAsPromised);

const ganache = Ganache.provider({
    mnemonic: "myth like bonus scare over problem client lizard pioneer submit female collect",
    gasLimit: 8000000
});
const nextConfig = {
    ...config,
    hostName: "localhost",
    hostPort: 3000,
    jsonRpcUrl: "http://localhost:8545",
    responderKey: "0x6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c",
    receiptKey: "0x6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c",
    watcherResponseConfirmations: 0
};

const provider = new ethers.providers.Web3Provider(ganache as ethers.providers.AsyncSendable);
provider.pollingInterval = 100;

const expect = chai.expect;

describe("Service end-to-end", () => {
    let account0: string,
        account1: string,
        wallet0: ethers.Signer,
        channelContract: ethers.Contract,
        oneWayChannelContract: ethers.Contract,
        hashState: string,
        disputePeriod: number,
        service: PisaService,
        db: LevelUp<encodingDown<string, any>>,
        pisaContractAddress: string,
        pisaClient: PisaClient;

    beforeEach(async () => {
        const responderWallet = new ethers.Wallet(nextConfig.responderKey, provider);

        db = levelup(
            encodingDown<string, any>(MemDown(), {
                valueEncoding: "json"
            })
        );

        const signerWallet = new ethers.Wallet(nextConfig.receiptKey!, provider);
        const pisaContract = await deployPisa(responderWallet);
        nextConfig.pisaContractAddress = pisaContract.address;
        pisaContractAddress = pisaContract.address;
        const nonce = await responderWallet.getTransactionCount();

        service = new PisaService(nextConfig, provider, responderWallet, nonce, provider.network.chainId, signerWallet, db);
        await service.start();

        // accounts
        const accounts = await provider.listAccounts();
        wallet0 = provider.getSigner(account0);
        account0 = accounts[0];
        account1 = accounts[1];

        // set the dispute period, greater than the inspector period
        disputePeriod = 11;

        // contract
        const channelContractFactory = new ethers.ContractFactory(KitsuneTools.ContractAbi, KitsuneTools.ContractBytecode, provider.getSigner());
        // add the responder as a user, so that it's allowed to call trigger dispute
        oneWayChannelContract = await channelContractFactory.deploy([pisaContractAddress], disputePeriod);
        channelContract = await channelContractFactory.deploy([account0, account1], disputePeriod);
        hashState = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("face-off"));
        pisaClient = new PisaClient(`http://${nextConfig.hostName}:${nextConfig.hostPort}`, pisaContractAddress);
    });

    afterEach(async () => {
        await service.stop();
        await db.close();
    });

    it("service cannot be accessed during startup", async () => {
        const responderWallet = new ethers.Wallet(nextConfig.responderKey, provider);
        const signerWallet = new ethers.Wallet(nextConfig.receiptKey!, provider);
        const nonce = await responderWallet.getTransactionCount();

        const exDb = levelup(
            encodingDown<string, any>(MemDown(), {
                valueEncoding: "json"
            })
        );
        const exService = new PisaService(
            { ...nextConfig, hostPort: nextConfig.hostPort + 1 },
            provider,
            responderWallet,
            nonce,
            provider.network.chainId,
            signerWallet,
            exDb
        );

        const exPisaClient = new PisaClient(`http://${nextConfig.hostName}:${nextConfig.hostPort + 1}`, pisaContractAddress);

        const round = 1;
        const setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address);
        const sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash));
        const sig1 = await provider.getSigner(account1).signMessage(ethers.utils.arrayify(setStateHash));
        const data = KitsuneTools.encodeSetStateData(hashState, round, sig0, sig1);
        const currentBlockNumber = await provider.getBlockNumber();
        try {
            const res = await exPisaClient.generateAndExecuteRequest(
                digest => wallet0.signMessage(arrayify(digest)),
                account0,
                "0x0000000000000000000000000000000000000000000000000000000000000001",
                0,
                currentBlockNumber,
                1000,
                channelContract.address,
                data,
                1000000,
                100,
                channelContract.address,
                KitsuneTools.topics()
            );

            chai.assert.fail();
        } catch (doh) {
            expect(doh.message).to.equal("Service initialising, please try again later.");
        }

        await exService.start();
        await exService.stop();
    });

    it("create channel, submit appointment, trigger dispute, wait for response", async () => {
        const round = 1;
        const setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address);
        const sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash));
        const sig1 = await provider.getSigner(account1).signMessage(ethers.utils.arrayify(setStateHash));
        const data = KitsuneTools.encodeSetStateData(hashState, round, sig0, sig1);
        const currentBlockNumber = await provider.getBlockNumber();
        await pisaClient.generateAndExecuteRequest(
            digest => wallet0.signMessage(arrayify(digest)),
            account0,
            "0x0000000000000000000000000000000000000000000000000000000000000001",
            0,
            currentBlockNumber,
            1000,
            channelContract.address,
            data,
            1000000,
            100,
            channelContract.address,
            KitsuneTools.topics()
        );

        // now register a callback on the setstate event and trigger a response
        const setStateEvent = "EventEvidence(uint256, bytes32)";
        let success = false;
        channelContract.on(setStateEvent, () => {
            channelContract.removeAllListeners(setStateEvent);
            success = true;
        });

        // trigger a dispute
        await wait(100);
        const tx = await channelContract.triggerDispute();
        await tx.wait();

        try {
            // wait for the success result
            await waitForPredicate(() => success, 50, 20);
        } catch (doh) {
            // fail if we dont get it
            chai.assert.fail(true, false, "EventEvidence not successfully registered.");
        }
    }).timeout(3000);

    it("create channel, submit appointment twice, trigger dispute, wait for response throws error", async () => {
        const round = 1;
        const setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address);
        const sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash));
        const sig1 = await provider.getSigner(account1).signMessage(ethers.utils.arrayify(setStateHash));
        const data = KitsuneTools.encodeSetStateData(hashState, round, sig0, sig1);
        const currentBlockNumber = await provider.getBlockNumber();
        const req = await pisaClient.generateRequest(
            (digest: string) => wallet0.signMessage(arrayify(digest)),
            account0,
            "0x0000000000000000000000000000000000000000000000000000000000000001",
            0,
            currentBlockNumber,
            1000,
            channelContract.address,
            data,
            1000000,
            100,
            channelContract.address,
            KitsuneTools.topics()
        );
        await pisaClient.executeRequest(req);
        (await expectAsync(pisaClient.executeRequest(req))).to.throw;

        // now register a callback on the setstate event and trigger a response
        const setStateEvent = "EventEvidence(uint256, bytes32)";
        let success = false;
        channelContract.on(setStateEvent, () => {
            channelContract.removeAllListeners(setStateEvent);
            success = true;
        });

        // trigger a dispute
        await wait(100);
        const tx = await channelContract.triggerDispute();
        await tx.wait();

        try {
            // wait for the success result
            await waitForPredicate(() => success, 50, 20);
        } catch (doh) {
            // fail if we dont get it
            chai.assert.fail(true, false, "EventEvidence not successfully registered.");
        }
    }).timeout(3000);

    it("create channel, relay trigger dispute", async () => {
        const data = KitsuneTools.encodeTriggerDisputeData();
        const currentBlockNumber = await provider.getBlockNumber();
        const req = await pisaClient.generateRequest(
            (digest: string) => wallet0.signMessage(arrayify(digest)),
            account0,
            "0x0000000000000000000000000000000000000000000000000000000000000001",
            0,
            currentBlockNumber,
            1000,
            oneWayChannelContract.address,
            data,
            1000000,
            100
        );

        // now register a callback on the setstate event and trigger a response
        const triggerDisputeEvent = "EventDispute(uint256)";
        let success = false;
        oneWayChannelContract.once(triggerDisputeEvent, async () => (success = true));

        await pisaClient.executeRequest(req);

        try {
            // wait for the success result
            await waitForPredicate(() => success, 50, 20);
        } catch (doh) {
            // fail if we dont get it
            chai.assert.fail(true, false, "EventDispute not successfully registered.");
        }
    }).timeout(3000);

    it("create channel, relay twice throws error trigger dispute", async () => {
        const data = KitsuneTools.encodeTriggerDisputeData();
        const currentBlockNumber = await provider.getBlockNumber();
        const req = await pisaClient.generateRequest(
            (digest: string) => wallet0.signMessage(arrayify(digest)),
            account0,
            "0x0000000000000000000000000000000000000000000000000000000000000001",
            0,
            currentBlockNumber,
            1000,
            oneWayChannelContract.address,
            data,
            1000000,
            100
        );

        // now register a callback on the setstate event and trigger a response
        const triggerDisputeEvent = "EventDispute(uint256)";
        let success = false;
        oneWayChannelContract.once(triggerDisputeEvent, async () => (success = true));

        await pisaClient.executeRequest(req);
        expect(await expectAsync(pisaClient.executeRequest(req))).to.throw;

        try {
            // wait for the success result
            await waitForPredicate(() => success, 50, 20);
        } catch (doh) {
            // fail if we dont get it
            chai.assert.fail(true, false, "EventDispute not successfully registered.");
        }
    }).timeout(3000);

    it("can get an appointment that was correctly submitted", async () => {
        const round = 1;
        const setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address);
        const sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash));
        const sig1 = await provider.getSigner(account1).signMessage(ethers.utils.arrayify(setStateHash));
        const data = KitsuneTools.encodeSetStateData(hashState, round, sig0, sig1);
        const currentBlockNumber = await provider.getBlockNumber();
        const { appointment } = await pisaClient.generateAndExecuteRequest(
            digest => wallet0.signMessage(arrayify(digest)),
            account0,
            "0x0000000000000000000000000000000000000000000000000000000000000001",
            0,
            currentBlockNumber,
            1000,
            channelContract.address,
            data,
            1000000,
            100,
            channelContract.address,
            KitsuneTools.topics()
        );

        const res = await pisaClient.getAppointmentsByCustomer(account0);
        expect(res).to.deep.equal([appointment]);
    }).timeout(3000);

    it("can get a multiple appointments", async () => {
        const round = 1;
        const setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address);
        const sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash));
        const sig1 = await provider.getSigner(account1).signMessage(ethers.utils.arrayify(setStateHash));
        const data = KitsuneTools.encodeSetStateData(hashState, round, sig0, sig1);
        const currentBlockNumber = await provider.getBlockNumber();
        const appointment1 = await pisaClient.generateAndExecuteRequest(
            digest => wallet0.signMessage(arrayify(digest)),
            account0,
            "0x0000000000000000000000000000000000000000000000000000000000000001",
            0,
            currentBlockNumber,
            1000,
            channelContract.address,
            data,
            1000000,
            100,
            channelContract.address,
            KitsuneTools.topics(),
        );
        const appointment2 = await pisaClient.generateAndExecuteRequest(
            digest => wallet0.signMessage(arrayify(digest)),
            account0,
            "0x0000000000000000000000000000000000000000000000000000000000000001",
            1,
            currentBlockNumber,
            1000,
            channelContract.address,
            data,
            1000000,
            100,
            channelContract.address,
            KitsuneTools.topics(),
        );
        const appointment3 = await pisaClient.generateAndExecuteRequest(
            digest => wallet0.signMessage(arrayify(digest)),
            account0,
            "0x0000000000000000000000000000000000000000000000000000000000000002",
            1,
            currentBlockNumber,
            1000,
            channelContract.address,
            data,
            1000000,
            100,
            channelContract.address,
            KitsuneTools.topics(),
        );

        const res = await pisaClient.getAppointmentsByCustomer(account0);
        expect(res).to.deep.equal([appointment2.appointment, appointment3.appointment]);
    }).timeout(3000);
});

// assess the value of a predicate every `interval` milliseconds, resolves if predicate evaluates to true; rejects after `repetitions` failed attempts
const waitForPredicate = <T1>(predicate: () => boolean, interval: number, repetitions: number) => {
    return new Promise((resolve, reject) => {
        const intervalHandle = setInterval(() => {
            if (predicate()) {
                resolve();
                clearInterval(intervalHandle);
            } else if (--repetitions <= 0) {
                reject();
            }
        }, interval);
    });
};
