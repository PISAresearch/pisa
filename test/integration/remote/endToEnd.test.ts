import "mocha";
import chai from "chai";
import DockerClient from "dockerode";
import { IArgConfig } from "../../../src/dataEntities/config";
import uuid from "uuid/v4";
import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { KitsuneTools } from "../../external/kitsune/tools";
import request from "request-promise";
import { wait } from "../../../src/utils";
import { PisaContainer, ParityContainer } from "../docker";
import { FileUtils } from "../fileUtil";
import { ChainData } from "../chainData";
import { KeyStore } from "../keyStore";
import { Appointment, IAppointmentRequest } from "../../../src/dataEntities";
import { groupTuples } from "../../../src/utils/ethers";
import { deployPisa } from "../../src/utils/contract";

const newId = () => {
    return uuid().substr(0, 8);
};

const prepareLogsDir = (dirPath: string) => {
    if (fs.existsSync(dirPath)) {
        FileUtils.rmRfDirSync(dirPath);
    }

    fs.mkdirSync(dirPath);
};

const encode = (request: IAppointmentRequest) => {
    const appointmentInfo = ethers.utils.defaultAbiCoder.encode(
        ...groupTuples([
            ["uint", request.id],
            ["uint", request.jobId],
            ["uint", request.startBlock],
            ["uint", request.endBlock],
            ["uint", request.challengePeriod],
            ["uint", request.refund],
            ["bytes32", request.paymentHash]
        ])
    );
    const contractInfo = ethers.utils.defaultAbiCoder.encode(
        ...groupTuples([
            ["address", request.contractAddress],
            ["address", request.customerAddress],
            ["uint", request.gasLimit],
            ["bytes", request.data]
        ])
    );
    const conditionInfo = ethers.utils.defaultAbiCoder.encode(
        ...groupTuples([
            ["bytes", ethers.utils.toUtf8Bytes(request.eventABI)],
            ["bytes", request.eventArgs],
            ["bytes", request.preCondition],
            ["bytes", request.postCondition],
            ["uint", request.mode]
        ])
    );

    return ethers.utils.defaultAbiCoder.encode(
        ...groupTuples([["bytes", appointmentInfo], ["bytes", contractInfo], ["bytes", conditionInfo]])
    );
};

describe("Integration", function() {
    this.timeout(60000);
    let pisa: PisaContainer,
        parity: ParityContainer,
        network: DockerClient.Network,
        parityPort: number,
        pisaContractAddress: string;

    before(async () => {
        const currentDirectory = __dirname;
        const logDir = "logs";
        const logsDirectory = path.join(currentDirectory, logDir);

        prepareLogsDir(logsDirectory);
        const chainData = new ChainData(
            "IntegrationPoA",
            [KeyStore.theKeyStore.account0],
            1,
            KeyStore.theKeyStore.account1
        );
        const dockerClient = new DockerClient();
        const networkName = `test-network-${newId()}`;
        parityPort = 8545;
        parity = new ParityContainer(
            dockerClient,
            `parity-${newId()}`,
            parityPort,
            logsDirectory,
            networkName,
            "info",
            chainData,
            KeyStore.theKeyStore.account0,
            [KeyStore.theKeyStore.account1]
        );
        await parity.start(true);

        const provider = new ethers.providers.JsonRpcProvider("http://localhost:8545");
        const wallet = new ethers.Wallet(KeyStore.theKeyStore.account1.wallet.privateKey, provider);
        const pisaContract = await deployPisa(wallet);
        pisaContractAddress = pisaContract.address;

        const config: IArgConfig = {
            dbDir: "db",
            hostName: "0.0.0.0",
            hostPort: 3000,
            loglevel: "info",
            jsonRpcUrl: `http://${parity.name}:${parityPort}`,
            responderKey: KeyStore.theKeyStore.account1.wallet.privateKey,
            receiptKey: KeyStore.theKeyStore.account1.wallet.privateKey,
            watcherResponseConfirmations: 0,
            pisaContractAddress: pisaContract.address
        };
        pisa = new PisaContainer(dockerClient, `pisa-${newId()}`, config, 3000, logsDirectory, networkName);

        network = await dockerClient.createNetwork({
            Name: networkName
        });

        await pisa.start(true);
        // adding a wait here appears to stop intermittent errors that occur
        // during the integration tests. This isnt a great solution but it works
        // for now
        await wait(10000);
    });

    after(async () => {
        await pisa.stop();
        await parity.stop();
        await network.remove();
    });

    it("End to end", async () => {
        const provider = new ethers.providers.JsonRpcProvider(`http://localhost:${parityPort}`);
        provider.pollingInterval = 100;
        const key0 = KeyStore.theKeyStore.account0;
        const key1 = KeyStore.theKeyStore.account1;
        const wallet0 = key0.wallet.connect(provider);
        const wallet1 = key0.wallet.connect(provider);

        // contract
        const channelContractFactory = new ethers.ContractFactory(
            KitsuneTools.ContractAbi,
            KitsuneTools.ContractBytecode,
            wallet0
        );
        const disputePeriod = 11;
        const channelContract = await channelContractFactory.deploy([key0.account, key1.account], disputePeriod);
        // pisa needs some time to initialise -and for some reason the contract needs time to set
        await wait(4000);

        const hashState = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("face-off"));
        const round = 1;
        const setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address);
        const sig0 = await key0.wallet.signMessage(ethers.utils.arrayify(setStateHash));
        const sig1 = await key1.wallet.signMessage(ethers.utils.arrayify(setStateHash));
        const currentBlock = await provider.getBlockNumber();
        const data = KitsuneTools.encodeSetStateData(hashState, round, sig0, sig1);

        const createAppointmentRequest = (data: string, acc: string, currentBlock: number): IAppointmentRequest => {
            return {
                challengePeriod: 100,
                contractAddress: channelContract.address,
                customerAddress: acc,
                data,
                endBlock: 22,
                eventABI: KitsuneTools.eventABI(),
                eventArgs: KitsuneTools.eventArgs(),
                gasLimit: "100000",
                id: 1,
                jobId: 0,
                mode: 1,
                preCondition: "0x",
                postCondition: "0x",
                refund: "0",
                startBlock: currentBlock,
                paymentHash: Appointment.FreeHash,
                customerSig: "0x"
            };
        };

        const appointment = createAppointmentRequest(data, key0.account, currentBlock);
        const hash = encode(appointment);
        const hashedWithAddress = ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(["bytes", "address"], [hash, pisaContractAddress])
        );
        const sig = await key0.wallet.signMessage(ethers.utils.arrayify(hashedWithAddress));

        const clone = { ...appointment, customerSig: sig };

        const res = await request.post(`http://localhost:${pisa.config.hostPort}/appointment`, {
            json: clone
        });

        // now register a callback on the setstate event and trigger a response
        const setStateEvent = "EventEvidence(uint256, bytes32)";
        let successResult = { success: false };
        channelContract.on(setStateEvent, () => {
            channelContract.removeAllListeners(setStateEvent);
            successResult.success = true;
        });

        // trigger a dispute
        const tx = await channelContract.triggerDispute();
        await tx.wait();

        await mineBlocks(5, wallet1);

        try {
            // wait for the success result
            await waitForPredicate(successResult, s => s.success, 400);
        } catch (doh) {
            // fail if we dont get it
            chai.assert.fail(true, false, "EventEvidence not successfully registered.");
        }
    });
});

const mineBlocks = async (count: number, signer: ethers.Signer) => {
    for (let i = 0; i < count; i++) {
        await mineBlock(signer);
    }
};

const mineBlock = async (signer: ethers.Signer) => {
    const tx = await signer.sendTransaction({ to: "0x0000000000000000000000000000000000000000", value: 0 });
    await tx.wait();
};

// assess the value of a predicate after a timeout, throws if predicate does not evaluate to true
const waitForPredicate = <T1>(successResult: T1, predicate: (a: T1) => boolean, timeout: number) => {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            if (predicate(successResult)) {
                resolve();
            } else {
                reject();
            }
        }, timeout);
    });
};
