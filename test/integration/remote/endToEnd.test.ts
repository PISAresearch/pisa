import "mocha";
import chai from "chai";
import DockerClient from "dockerode";
import { IArgConfig } from "../../../src/dataEntities/config";
import uuid from "uuid/v4";
import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { KitsuneTools } from "../../../src/integrations/kitsune";
import request from "request-promise";
import { ChannelType } from "../../../src/dataEntities";
import { wait } from "../../../src/utils";
import { PisaContainer, ParityContainer } from "../docker";
import { FileUtils } from "../fileUtil";
import { ChainData } from "../chainData";
import { KeyStore } from "../keyStore";

const newId = () => {
    return uuid().substr(0, 8);
};

const prepareLogsDir = (dirPath: string) => {
    if (fs.existsSync(dirPath)) {
        FileUtils.rmRfDirSync(dirPath);
    }

    fs.mkdirSync(dirPath);
};

describe("Integration", function() {
    this.timeout(60000);
    let pisa: PisaContainer, parity: ParityContainer, network: DockerClient.Network, parityPort: number;

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
        const config: IArgConfig = {
            dbDir: "db",
            hostName: "0.0.0.0",
            hostPort: 3000,
            jsonRpcUrl: `http://${parity.name}:${parityPort}`,
            responderKey: "0x549a24a594a51f0bea8655a80c01689206a811120e2b28683d6b202f096a2049",
            receiptKey: "0x549a24a594a51f0bea8655a80c01689206a811120e2b28683d6b202f096a2049"
        };
        pisa = new PisaContainer(dockerClient, `pisa-${newId()}`, config, 3000, logsDirectory, networkName);

        network = await dockerClient.createNetwork({
            Name: networkName
        });

        await parity.start(true);
        await pisa.start(true);
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
        await wait(3000);

        const hashState = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("face-off"));
        const round = 1;
        const setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address);
        const sig0 = await key0.wallet.signMessage(ethers.utils.arrayify(setStateHash));
        const sig1 = await key1.wallet.signMessage(ethers.utils.arrayify(setStateHash));
        const expiryPeriod = disputePeriod + 1;
        const appointment = {
            expiryPeriod,
            type: ChannelType.Kitsune,
            stateUpdate: {
                contractAddress: channelContract.address,
                hashState,
                round,
                signatures: [sig0, sig1]
            }
        };

        const res = await request.post(`http://localhost:${pisa.config.hostPort}/appointment`, {
            json: appointment
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

        await mineBlocks(3, wallet1);

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
