import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import mockito, { verify, when, mock, instance, anything } from "ts-mockito";
import sinon from "sinon";
import "mocha";
import { ethers, Contract } from "ethers";
import Ganache from "ganache-core";
import { KitsuneAppointment, KitsuneTools } from "../../src/integrations/kitsune";
import {
    EthereumDedicatedResponder,
    ResponderEvent,
    StuckTransactionError,
    DoublingGasPolicy,
    EthereumTransactionMiner
} from "../../src/responder";
import { CancellablePromise } from "../../src/utils";
import {
    ChannelType,
    BlockThresholdReachedError,
    ReorgError,
    BlockTimeoutError,
    IBlockStub,
    HasTxHashes
} from "../../src/dataEntities";
import { BlockCache, BlockProcessor, BlockTimeoutDetector } from "../../src/blockMonitor";
import { ConfirmationObserver } from "../../src/blockMonitor/confirmationObserver";
import { minimalBlockFactory } from "../../src/blockMonitor/blockProcessor";

chai.use(chaiAsPromised);
chai.use(require("sinon-chai"));

const expect = chai.expect;

// Repeated code for multiple tests
async function getTestData(
    provider: ethers.providers.JsonRpcProvider,
    account0: string,
    account1: string,
    responderAccount: string,
    hashState: string,
    channelContract: Contract,
    disputePeriod: number
) {
    const signer = provider.getSigner(responderAccount);
    const round = 1,
        setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address),
        sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash)),
        sig1 = await provider.getSigner(account1).signMessage(ethers.utils.arrayify(setStateHash)),
        expiryPeriod = disputePeriod + 1;
    const appointment = new KitsuneAppointment({
        stateUpdate: {
            contractAddress: channelContract.address,
            hashState,
            round,
            signatures: [sig0, sig1]
        },
        expiryPeriod,
        type: ChannelType.Kitsune
    });

    const responseData = appointment.getResponseData();

    return {
        signer,
        round,
        setStateHash,
        sig0,
        sig1,
        expiryPeriod,
        appointment,
        responseData
    };
}

// Commodity functions

//make a copy of the global time-related functions for tests that use sinon fake timers.
const _setTimeout = global.setTimeout;

// Save a snapshot of the state of the blockchain in ganache; resolves to the id of the snapshot
function takeGanacheSnapshot(ganache: any): Promise<string> {
    return new Promise(async (resolve, reject) => {
        ganache.sendAsync({ id: 1, jsonrpc: "2.0", method: "evm_snapshot", params: [] }, (err: any, res: any) => {
            if (err) {
                console.log("WARNING: error while creating ganache snapshot");
                reject(err);
            } else {
                resolve(res.result);
            }
        });
    });
}

// Restores a previously saved snapshot given the id. Note: the id _cannot_ be reused
function restoreGanacheSnapshot(ganache: any, id: string) {
    return new Promise(async (resolve, reject) => {
        ganache.sendAsync({ id: 1, jsonrpc: "2.0", method: "evm_revert", params: [id] }, (err: any, _: any) => {
            if (err) {
                console.log("WARNING: error while restoring ganache snapshot");
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

// Instructs ganache to mine a block; returns a promise that resolves only
// when one at least one block has been mined.
// Resolves to the number of the last block mined.
function mineBlock(ganache: any, provider: ethers.providers.Web3Provider): Promise<number> {
    return new Promise(async (resolve, reject) => {
        const initialBlockNumber = await provider.getBlockNumber();

        ganache.sendAsync({ id: 1, jsonrpc: "2.0", method: "evm_mine", params: [] }, (err: any, _: any) => {
            if (err) reject(err);
        });

        const testBlockNumber = async function() {
            const blockNumber = await provider.getBlockNumber();
            if (blockNumber > initialBlockNumber) {
                resolve(blockNumber);
            } else {
                _setTimeout(testBlockNumber, 10);
            }
        };
        _setTimeout(testBlockNumber, 10);
    });
}

// Tests `predicate()` every `interval` milliseconds; resolve only when `predicate` is truthy.
function waitFor(predicate: () => boolean, interval: number = 50): Promise<void> {
    return new Promise(resolve => {
        const test = function() {
            if (predicate()) {
                resolve();
            } else {
                _setTimeout(test, interval);
            }
        };
        test();
    });
}

// Returns a promise that waits for a sinon spy to be called and resolves to the return value of the first call.
function waitForSpy(spy: any, interval = 20) {
    return new Promise(resolve => {
        const testSpy = function() {
            if (spy.called) {
                resolve(spy.getCall(0).returnValue);
            } else {
                _setTimeout(testSpy, interval);
            }
        };
        testSpy();
    });
}

describe("EthereumDedicatedResponder", () => {
    let ganache: any;
    let provider: ethers.providers.Web3Provider;
    let blockCache: BlockCache<IBlockStub & HasTxHashes>;
    let blockProcessor: BlockProcessor<IBlockStub & HasTxHashes>;
    let blockTimeoutDetector: BlockTimeoutDetector;
    let confirmationObserver: ConfirmationObserver<IBlockStub & HasTxHashes>;
    let transactionMiner: EthereumTransactionMiner;

    let account0: string, account1: string, responderAccount: string;
    let disputePeriod: number, channelContract: ethers.Contract, hashState: string;

    let testData: any;

    const setup = async (ganacheOptions: any = {}) => {
        ganache = Ganache.provider(ganacheOptions);
        provider = new ethers.providers.Web3Provider(ganache);
        provider.pollingInterval = 100;

        blockCache = new BlockCache<IBlockStub & HasTxHashes>(100);
        blockProcessor = new BlockProcessor<IBlockStub & HasTxHashes>(provider, minimalBlockFactory, blockCache);
        await blockProcessor.start();

        blockTimeoutDetector = new BlockTimeoutDetector(blockProcessor, 120 * 1000);
        await blockTimeoutDetector.start();
        confirmationObserver = new ConfirmationObserver(blockProcessor);
        await confirmationObserver.start();

        // Set up the accounts
        const accounts = await provider.listAccounts();
        account0 = accounts[0];
        account1 = accounts[1];
        responderAccount = accounts[2];

        transactionMiner = new EthereumTransactionMiner(
            provider.getSigner(responderAccount),
            blockTimeoutDetector,
            confirmationObserver,
            40,
            10
        );

        // set the dispute period
        disputePeriod = 11;

        // deploy the contract
        const channelContractFactory = new ethers.ContractFactory(
            KitsuneTools.ContractAbi,
            KitsuneTools.ContractBytecode,
            provider.getSigner()
        );
        channelContract = await channelContractFactory.deploy([account0, account1], disputePeriod);

        if (!!ganacheOptions.blockTime) {
            // If a blockTime is specified, we force mining a block now, as ganache doesn't do it automatically.
            ganache.sendAsync({ id: 1, jsonrpc: "2.0", method: "evm_mine", params: [] }, () => {});
        }

        // store an off-chain hashState
        hashState = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("to the moon"));

        // trigger a dispute
        const account0Contract = channelContract.connect(provider.getSigner(account0));
        const tx = await account0Contract.triggerDispute();

        if (!!ganacheOptions.blockTime) {
            // If a blockTime is specified, we force mining a block now, as ganache doesn't do it automatically.
            ganache.sendAsync({ id: 1, jsonrpc: "2.0", method: "evm_mine", params: [] }, () => {});
        }

        await tx.wait();

        testData = await getTestData(
            provider,
            account0,
            account1,
            responderAccount,
            hashState,
            channelContract,
            disputePeriod
        );
    };

    beforeEach(async () => {
        await setup();
    });

    afterEach(async () => {
        sinon.restore();
    });

    it("correctly submits an appointment to the blockchain", async () => {
        const { signer, appointment, responseData } = testData;

        const responder = new EthereumDedicatedResponder(
            signer,
            new DoublingGasPolicy(provider),
            40,
            10,
            transactionMiner
        );
        const promise = new Promise((resolve, reject) => {
            responder.on(ResponderEvent.ResponseSent, resolve);
            responder.on(ResponderEvent.AttemptFailed, reject);
        });

        responder.startResponse(appointment.id, responseData);

        await promise; // Make sure the ResponseSent event is generated

        // Make sure that transaction is confirmed
        await mineBlock(ganache, provider);

        // Test if the channel hashed state has been updated
        const channelState = await channelContract.hstate();
        expect(channelState).to.equal(hashState);
    });

    // TODO: this test is failing because of the timeouts. It seems due to sinon's fake timers not working well with Promises.
    // it("emits the AttemptFailed and ResponseFailed events the correct number of times on failure", async () => {
    //     const clock = sinon.useFakeTimers();

    //     const { signer, appointment, responseData } = testData;

    //     const nAttempts = 5;
    //     const responder = new EthereumDedicatedResponder(signer, new DoublingGasPolicy(provider), 40, nAttempts, transactionMiner);

    //     const attemptFailedSpy = sinon.spy();
    //     const responseFailedSpy = sinon.spy();
    //     const responseSentSpy = sinon.spy();
    //     const responseConfirmedSpy = sinon.spy();

    //     // Make sendTransaction return promises that never resolve
    //     sinon.replace(signer, 'sendTransaction', () => new Promise(() => {}));

    //     responder.on(ResponderEvent.AttemptFailed, attemptFailedSpy);
    //     responder.on(ResponderEvent.ResponseFailed, responseFailedSpy);
    //     responder.on(ResponderEvent.ResponseSent, responseSentSpy);
    //     responder.on(ResponderEvent.ResponseConfirmed, responseConfirmedSpy);

    //     // Start the response flow
    //     responder.startResponse(appointment.id, responseData);

    //     const tickWaitTime = 1000 + EthereumDedicatedResponder.WAIT_TIME_FOR_PROVIDER_RESPONSE + EthereumDedicatedResponder.WAIT_TIME_BETWEEN_ATTEMPTS;

    //     // The test seems to fail if we make time steps that are too large; instead, we proceed at 1 second ticks
    //     for (let i = 0; i < nAttempts; i++) {
    //         clock.tick(tickWaitTime);
    //         await Promise.resolve();

    //         await waitFor(() => attemptFailedSpy.callCount > i);
    //     }

    //     // Let's make sure there is time after the last iteration
    //     clock.tick(tickWaitTime);
    //     await Promise.resolve();

    //     expect(attemptFailedSpy.callCount, "emitted AttemptFailed the right number of times").to.equal(nAttempts);
    //     expect(responseFailedSpy.callCount, "emitted ResponseFailed exactly once").to.equal(1);
    //     expect(responseSentSpy.called, "did not emit ResponseSent").to.be.false;
    //     expect(responseConfirmedSpy.called, "did not emit ResponseConfirmed").to.be.false;

    //     clock.restore();
    //     sinon.restore();
    // });

    it("emits the AttemptFailed with a BlockTimeoutError if there is no new block for too long", async () => {
        const { signer, appointment, responseData } = testData;

        const nAttempts = 1;
        const responder = new EthereumDedicatedResponder(
            signer,
            new DoublingGasPolicy(provider),
            40,
            nAttempts,
            transactionMiner
        );

        const attemptFailedSpy = sinon.spy();
        const responseFailedSpy = sinon.spy();
        const responseSentSpy = sinon.spy();
        const responseConfirmedSpy = sinon.spy();

        responder.on(ResponderEvent.AttemptFailed, attemptFailedSpy);
        responder.on(ResponderEvent.ResponseSent, responseSentSpy);
        responder.on(ResponderEvent.ResponseFailed, responseFailedSpy);
        responder.on(ResponderEvent.ResponseConfirmed, responseConfirmedSpy);

        // Start the response flow
        responder.startResponse(appointment.id, responseData);

        // Wait for the response to be sent
        await waitForSpy(responseSentSpy);

        // Simulate provider timeout through the blockTimeoutDetector
        blockTimeoutDetector.emit(BlockTimeoutDetector.BLOCK_TIMEOUT_EVENT);

        await waitForSpy(attemptFailedSpy);

        // Check if the parameter of the attemptFailed event is an error of type BlockTimeoutError
        const args = attemptFailedSpy.args[0]; //arguments of the first call
        expect(args[1] instanceof BlockTimeoutError, "AttemptFailed emitted with BlockTimeoutError").to.be.true;
    });

    // TODO: this test currently passes but node complains with UnhandledPromiseRejectionWarning for Reorg (but exception is caught in the responder!)
    it("emits the AttemptFailed with a ReorgError if a re-org kicks out the transaction before enough confirmations", async () => {
        const { signer, appointment, responseData } = testData;

        const mockedTransactionMiner = mock(EthereumTransactionMiner);
        when(mockedTransactionMiner.sendTransaction(anything())).thenResolve("0x1234");
        when(mockedTransactionMiner.waitForFirstConfirmation("0x1234")).thenResolve();
        when(mockedTransactionMiner.waitForEnoughConfirmations("0x1234")).thenReject(
            new ReorgError("There was a re-org.")
        );

        const nAttempts = 1;
        const responder = new EthereumDedicatedResponder(
            signer,
            new DoublingGasPolicy(provider),
            40,
            nAttempts,
            instance(mockedTransactionMiner)
        );

        const attemptFailedSpy = sinon.spy();
        responder.on(ResponderEvent.AttemptFailed, attemptFailedSpy);

        // Start the response flow
        responder.startResponse(appointment.id, responseData);

        await waitForSpy(attemptFailedSpy);

        const args = attemptFailedSpy.args[0]; //arguments of the first call
        expect(args[1] instanceof ReorgError).to.be.true;
    });

    it("emits StuckTransactionError if WAIT_BLOCKS_BEFORE_RETRYING blocks are mined and the transaction is not included", async () => {
        // setup ganache so that blocks are created manually
        await setup({ blockTime: 10000 });

        const { signer, appointment, responseData } = testData;

        // mock miner that always thinks transaction got stuck
        const mockedTransactionMiner = mock(EthereumTransactionMiner);
        when(mockedTransactionMiner.sendTransaction(anything())).thenResolve("0x1234");
        when(mockedTransactionMiner.waitForFirstConfirmation("0x1234")).thenReject(
            new BlockThresholdReachedError("Block threshold reached")
        );

        const nAttempts = 1;
        const responder = new EthereumDedicatedResponder(
            signer,
            new DoublingGasPolicy(provider),
            40,
            nAttempts,
            instance(mockedTransactionMiner)
        );

        const attemptFailedSpy = sinon.spy();
        responder.on(ResponderEvent.AttemptFailed, attemptFailedSpy);

        // Start the response flow
        const res = responder.startResponse(appointment.id, responseData);
        await waitForSpy(attemptFailedSpy);

        const args = attemptFailedSpy.args[0]; //arguments of the first call
        expect(args[1] instanceof StuckTransactionError).to.be.true;
    });

    // TODO: this test occasionally fails with timeout
    it("emits the ResponseSent event, followed by ResponseConfirmed after enough confirmations", async () => {
        const { signer, appointment, responseData } = testData;

        // mock miner that always thinks transaction got stuck
        const mockedTransactionMiner = mock(EthereumTransactionMiner);
        when(mockedTransactionMiner.sendTransaction(anything())).thenResolve("0x1234");
        when(mockedTransactionMiner.waitForFirstConfirmation("0x1234")).thenResolve();
        when(mockedTransactionMiner.waitForEnoughConfirmations("0x1234")).thenResolve();

        const nAttempts = 5;
        const nConfirmations = 5;
        const responder = new EthereumDedicatedResponder(
            signer,
            new DoublingGasPolicy(provider),
            nConfirmations,
            nAttempts,
            instance(mockedTransactionMiner)
        );

        const attemptFailedSpy = sinon.spy();
        const responseFailedSpy = sinon.spy();
        const responseSentSpy = sinon.spy();
        const responseConfirmedSpy = sinon.spy();

        responder.on(ResponderEvent.AttemptFailed, attemptFailedSpy);
        responder.on(ResponderEvent.ResponseFailed, responseFailedSpy);
        responder.on(ResponderEvent.ResponseSent, responseSentSpy);
        responder.on(ResponderEvent.ResponseConfirmed, responseConfirmedSpy);

        // Start the response flow
        responder.startResponse(appointment.id, responseData);

        // Wait for the response to be sent
        await waitForSpy(responseSentSpy);
        await waitForSpy(responseConfirmedSpy);

        // Now the response is confirmed
        expect(responseSentSpy.called, "emitted ResponseSent").to.be.true;
        expect(responseConfirmedSpy.called, "emitted ResponseConfirmed").to.be.true;
        expect(responseSentSpy.calledBefore(responseConfirmedSpy), "emitted ResponseSent before ResponseConfirmed").to
            .be.true;

        // No failed event should have been generated
        expect(attemptFailedSpy.called, "did not emit AttemptFailed").to.be.false;
        expect(responseFailedSpy.called, "did not emit ResponseFailed").to.be.false;
    });
});

describe("EthereumTransactionMiner", async () => {
    let ganache: any;
    let provider: ethers.providers.Web3Provider;
    let blockCache: BlockCache<IBlockStub & HasTxHashes>;
    let blockProcessor: BlockProcessor<IBlockStub & HasTxHashes>;
    let blockTimeoutDetector: BlockTimeoutDetector;
    let confirmationObserver: ConfirmationObserver<IBlockStub & HasTxHashes>;
    let accounts: string[];
    let account0Signer: ethers.Signer;
    let transactionRequest: ethers.providers.TransactionRequest;

    beforeEach(async () => {
        ganache = Ganache.provider({
            blockTime: 100000 // disable automatic blocks
        } as any); // TODO: remove generic types when @types/ganache-core is updated
        provider = new ethers.providers.Web3Provider(ganache);
        provider.pollingInterval = 20;
        blockCache = new BlockCache<IBlockStub & HasTxHashes>(200);
        blockProcessor = new BlockProcessor<IBlockStub & HasTxHashes>(provider, minimalBlockFactory, blockCache);
        await blockProcessor.start();
        blockTimeoutDetector = new BlockTimeoutDetector(blockProcessor, 120 * 1000);
        await blockTimeoutDetector.start();
        confirmationObserver = new ConfirmationObserver(blockProcessor);
        await confirmationObserver.start();
        accounts = await provider.listAccounts();
        account0Signer = provider.getSigner(accounts[0]);
        transactionRequest = {
            to: accounts[1],
            value: ethers.utils.parseEther("0.1")
        };
    });

    it("sendTransaction sends a transaction correctly", async () => {
        const spiedSigner = mockito.spy(account0Signer);
        const miner = new EthereumTransactionMiner(account0Signer, blockTimeoutDetector, confirmationObserver, 5, 10);

        await miner.sendTransaction(transactionRequest);

        verify(spiedSigner.sendTransaction(transactionRequest)).called();
    });

    it("sendTransaction re-throws the same error if the signer's sendTransaction throws", async () => {
        const spiedSigner = mockito.spy(account0Signer);
        const miner = new EthereumTransactionMiner(account0Signer, blockTimeoutDetector, confirmationObserver, 5, 10);
        const error = new Error("Some error");
        when(spiedSigner.sendTransaction(transactionRequest)).thenThrow(error);

        const res = miner.sendTransaction(transactionRequest);

        return expect(res).to.be.rejectedWith(error);
    });

    it("waitForFirstConfirmation resolves after the transaction is confirmed", async () => {
        const miner = new EthereumTransactionMiner(account0Signer, blockTimeoutDetector, confirmationObserver, 5, 10);

        const txHash = await miner.sendTransaction(transactionRequest);

        const res = miner.waitForFirstConfirmation(txHash);

        await mineBlock(ganache, provider);

        return expect(res).to.be.fulfilled;
    });

    it("waitForFirstConfirmation throws BlockTimeoutError after timeout", async () => {
        const miner = new EthereumTransactionMiner(account0Signer, blockTimeoutDetector, confirmationObserver, 5, 10);

        const txHash = await miner.sendTransaction(transactionRequest);

        const res = miner.waitForFirstConfirmation(txHash);

        // Simulates BLOCK_TIMEOUT_EVENT
        blockTimeoutDetector.emit(BlockTimeoutDetector.BLOCK_TIMEOUT_EVENT);

        return expect(res).to.be.rejectedWith(BlockTimeoutError);
    });

    it("waitForFirstConfirmation throws BlockThresholdReachedError if the transaction is stuck", async () => {
        const blockThresholdForStuckTransaction = 10;
        const spiedSigner = mockito.spy(account0Signer);

        // Fake date for responses
        const fakeTxReceipt: ethers.providers.TransactionReceipt = {
            confirmations: 0,
            from: "",
            to: "",
            byzantium: true
        };
        const fakeTxResponse: ethers.providers.TransactionResponse = {
            hash: "0x1234", // only relevant value
            confirmations: 0,
            from: "",
            to: "",
            wait: (confirmations: number | undefined) => Promise.resolve(fakeTxReceipt),
            nonce: 0,
            gasLimit: new ethers.utils.BigNumber(21000),
            gasPrice: new ethers.utils.BigNumber(20000000000),
            data: "",
            value: new ethers.utils.BigNumber(0),
            chainId: 0
        };

        // Fake a response, but does not actually send the transaction
        when(spiedSigner.sendTransaction(transactionRequest)).thenResolve(fakeTxResponse);

        const miner = new EthereumTransactionMiner(
            account0Signer,
            blockTimeoutDetector,
            confirmationObserver,
            5,
            blockThresholdForStuckTransaction
        );
        const txHash = await miner.sendTransaction(transactionRequest);

        const res = miner.waitForFirstConfirmation(txHash);

        // Simulate blockThresholdForStuckTransaction new blocks without mining the transaction
        for (let i = 1; i <= blockThresholdForStuckTransaction + 1; i++) {
            await mineBlock(ganache, provider);
        }

        return expect(res).to.be.rejectedWith(BlockThresholdReachedError);
    });

    it("waitForEnoughConfirmations resolves after enough confirmations", async () => {
        const confirmationsRequired = 5;
        const miner = new EthereumTransactionMiner(
            account0Signer,
            blockTimeoutDetector,
            confirmationObserver,
            confirmationsRequired,
            10
        );
        const txHash = await miner.sendTransaction(transactionRequest);

        // Mine the first confirmation
        await mineBlock(ganache, provider);
        await miner.waitForFirstConfirmation(txHash);

        const res = miner.waitForEnoughConfirmations(txHash);

        // Mine confirmationsRequired - 1 additional blocks
        for (let i = 0; i < confirmationsRequired - 1; i++) {
            await mineBlock(ganache, provider);
        }

        return expect(res).to.be.fulfilled;
    });

    it("waitForEnoughConfirmations throws BlockTimeoutError after timeout", async () => {
        const miner = new EthereumTransactionMiner(account0Signer, blockTimeoutDetector, confirmationObserver, 5, 10);
        const txHash = await miner.sendTransaction(transactionRequest);

        await mineBlock(ganache, provider);
        await miner.waitForFirstConfirmation(txHash);

        const res = miner.waitForEnoughConfirmations(txHash);

        // Simulates BLOCK_TIMEOUT_EVENT
        blockTimeoutDetector.emit(BlockTimeoutDetector.BLOCK_TIMEOUT_EVENT);

        return expect(res).to.be.rejectedWith(BlockTimeoutError);
    });

    it("waitForEnoughConfirmations throws ReorgError if the transaction is not found by the provider", async () => {
        const mockConfirmationObserver = mock(ConfirmationObserver);

        const miner = new EthereumTransactionMiner(
            account0Signer,
            blockTimeoutDetector,
            instance(mockConfirmationObserver),
            5,
            10
        );

        const txHash = await miner.sendTransaction(transactionRequest);

        when(mockConfirmationObserver.waitForFirstConfirmationOrBlockThreshold(txHash, anything())).thenReturn(
            new CancellablePromise(resolve => resolve())
        );

        await miner.waitForFirstConfirmation(txHash);

        when(mockConfirmationObserver.waitForConfirmationsOrReorg(txHash, anything())).thenReturn(
            new CancellablePromise((_, reject) => reject(new ReorgError("There was a reorg")))
        );

        const res = miner.waitForEnoughConfirmations(txHash);

        return expect(res).to.be.rejectedWith(ReorgError);
    });
});
