import "mocha";
import chai from "chai";
import DockerClient from "dockerode";
import { IArgConfig } from "../../../src/dataEntities/config";
import uuid from "uuid/v4";
import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { KitsuneTools } from "../../external/kitsune/tools";
import { wait } from "../../../src/utils";
import { PisaContainer, ParityContainer } from "../docker";
import { FileUtils } from "../fileUtil";
import { ChainData } from "../chainData";
import { KeyStore } from "../keyStore";
import { deployPisa } from "../../src/utils/contract";
import { PisaClient } from "../../../client";

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
    this.timeout(100000);
    let pisa: PisaContainer,
        parity: ParityContainer,
        network: DockerClient.Network,
        parityPort: number,
        provider: ethers.providers.JsonRpcProvider,
        client: PisaClient;

    beforeEach(async () => {
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
        network = await dockerClient.createNetwork({
            Name: networkName
        });
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
        await wait(5000);
        provider = new ethers.providers.JsonRpcProvider(`http://localhost:${parityPort}`);
        provider.pollingInterval = 100;
        const wallet = new ethers.Wallet(KeyStore.theKeyStore.account1.wallet.privateKey, provider);
        const pisaContract = await deployPisa(wallet);

        const pisaPort = 3000;
        const config: IArgConfig = {
            dbDir: "db",
            hostName: "0.0.0.0",
            hostPort: pisaPort,
            loglevel: "info",
            jsonRpcUrl: `http://${parity.name}:${parityPort}`,
            responderKey: KeyStore.theKeyStore.account1.wallet.privateKey,
            receiptKey: KeyStore.theKeyStore.account1.wallet.privateKey,
            watcherResponseConfirmations: 0,
            pisaContractAddress: pisaContract.address
        };

        pisa = new PisaContainer(dockerClient, `pisa-${newId()}`, config, pisaPort, logsDirectory, networkName);

        await pisa.start(true);

        client = new PisaClient(`http://0.0.0.0:${pisaPort}`, pisaContract.address);
        // adding a wait here appears to stop intermittent errors that occur
        // during the integration tests. This isnt a great solution but it works
        // for now
        await wait(10000);
    });

    afterEach(async () => {
        await pisa.stop();
        await parity.stop();
        await network.remove();
    });

    it("End to end", async () => {
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
        // pisa needs some time to initialise - and for some reason the contract needs time to set
        await wait(4000);

        const hashState = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("face-off"));
        const round = 1;
        const setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address);
        const sig0 = await key0.wallet.signMessage(ethers.utils.arrayify(setStateHash));
        const sig1 = await key1.wallet.signMessage(ethers.utils.arrayify(setStateHash));
        const currentBlock = await provider.getBlockNumber();
        const data = KitsuneTools.encodeSetStateData(hashState, round, sig0, sig1);
        const id = "0x0000000000000000000000000000000000000000000000000000000000000001";

        await client.generateAndExecuteRequest(
            disgest => key0.wallet.signMessage(ethers.utils.arrayify(disgest)),
            channelContract.address,
            key0.account,
            currentBlock,
            1000,
            100,
            id,
            0,
            data,
            1000000,
            channelContract.address,
            KitsuneTools.eventABI(),
            KitsuneTools.eventArgs()
        );

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
            await waitForPredicate(successResult, s => s.success, 1000);
        } catch (doh) {
            // fail if we dont get it
            chai.assert.fail(true, false, "EventEvidence not successfully registered.");
        }
    });

    it("End to end, multiple appointments", async () => {
        // like the previous test, but with multiple clients sending requests in parallel to Pisa.

        const nRuns = 5; // number of channels

        const disputePeriod = 11;

        const wallets0: ethers.Wallet[] = [];
        const wallets1: ethers.Wallet[] = [];

        const channelContractPromises: Promise<ethers.Contract>[] = [];
        for (let i = 0; i < nRuns; i++) {
            // for the i-th request, we create two wallets wallets0[i] and wallet1[i]

            // prettier-ignore
            const mnemonic0 = ethers.utils.HDNode.entropyToMnemonic([ // 15 + 1 bytes
                1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
                i
            ]);

            const wall0 = ethers.Wallet.fromMnemonic(mnemonic0);
            wallets0.push(wall0.connect(provider));
            await wait(2000);

            // prettier-ignore
            const mnemonic1 = ethers.utils.HDNode.entropyToMnemonic([
                // 15 + 1 bytes
                100, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
                i
            ]);
            const wall1 = ethers.Wallet.fromMnemonic(mnemonic1);
            wallets1.push(wall1.connect(provider));

            // contract
            const channelContractFactory = new ethers.ContractFactory(
                KitsuneTools.ContractAbi,
                KitsuneTools.ContractBytecode,
                wallets0[i]
            );
            channelContractPromises.push(
                channelContractFactory.deploy([wallets0[i].address, wallets1[i].address], disputePeriod)
            );
        }

        const channelContracts = await Promise.all(channelContractPromises);

        // pisa needs some time to initialise - and for some reason the contract needs time to set
        await wait(4000);

        const successResults = new Array(nRuns).fill(false);

        for (let i = 0; i < nRuns; i++) {
            const hashState = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("face-off"));
            const round = 1;
            const setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContracts[i].address);
            const sig0 = await wallets0[i].signMessage(ethers.utils.arrayify(setStateHash));
            const sig1 = await wallets1[i].signMessage(ethers.utils.arrayify(setStateHash));
            const data = KitsuneTools.encodeSetStateData(hashState, round, sig0, sig1);

            const id = "0x0000000000000000000000000000000000000000000000000000000000000001";

            await client.generateAndExecuteRequest(
                disgest => wallets0[i].signMessage(ethers.utils.arrayify(disgest)),
                channelContracts[i].address,
                wallets0[i].address,
                0,
                1000,
                100,
                id,
                0,
                data,
                1000000,
                channelContracts[i].address,
                KitsuneTools.eventABI(),
                KitsuneTools.eventArgs()
            );

            // now register a callback on the setstate event and trigger a response
            const setStateEvent = "EventEvidence(uint256, bytes32)";

            const makeListener = (idx: number) => () => {
                channelContracts[idx].removeAllListeners(setStateEvent);
                successResults[idx] = true;
            };

            channelContracts[i].on(setStateEvent, makeListener(i));
        }

        const waitTxPromises: Promise<ethers.providers.TransactionReceipt>[] = [];
        for (let i = 0; i < nRuns; i++) {
            // trigger a dispute, create a promise to wait for the transaction to be mined
            waitTxPromises.push(channelContracts[i].triggerDispute().then((tx: any) => tx.wait()));
        }

        // wait for all transactions to be mined (should all be in the same block)
        const results = await Promise.all(waitTxPromises);
        const blockNumbers = results.map(tx => tx.blockNumber);
        if (new Set(blockNumbers).size !== 1) {
            // we expect all the transactions to be in the same block in this test; fail otherwise
            const blockNumbersStr = `[${blockNumbers.join(", ")}]`;
            chai.assert.fail(true, false, `Expected all the transactions to be in the same block, instead these are the block numbers: ${blockNumbersStr}. This test might be broken.`); // prettier-ignore
        }

        await mineBlocks(5, wallets0[0]);

        try {
            // wait for the success results
            await waitForPredicate(successResults, s => s.every(t => t === true), 2000);
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
