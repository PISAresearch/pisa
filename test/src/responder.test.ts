import * as chai from "chai";
import sinon from "sinon";
import "mocha";
import { ethers } from "ethers";
import Ganache from "ganache-core";
import { KitsuneAppointment, KitsuneTools } from "../../src/integrations/kitsune";
import { EthereumDedicatedResponder, ResponderEvent, StuckTransactionError, DoublingGasPolicy } from "../../src/responder";
import { ReorgError, NoNewBlockError } from "../../src/utils/ethers";
import { ChannelType } from "../../src/dataEntities";
import chaiAsPromised from "chai-as-promised";

chai.use(chaiAsPromised);
chai.use(require('sinon-chai'));

const expect = chai.expect;


async function initTest(ganacheProviderOptions: any = {}) {
    const ganache = Ganache.provider(ganacheProviderOptions);
    const provider = new ethers.providers.Web3Provider(ganache);
    provider.pollingInterval = 100;

    // Set up the accounts
    const accounts = await provider.listAccounts();
    const account0 = accounts[0];
    const account1 = accounts[1];
    const responderAccount = accounts[2];

    // set the dispute period
    const disputePeriod = 11;

    // deploy the contract
    const channelContractFactory = new ethers.ContractFactory(
        KitsuneTools.ContractAbi,
        KitsuneTools.ContractBytecode,
        provider.getSigner()
    );
    const channelContract = await channelContractFactory.deploy([account0, account1], disputePeriod);
    if (!!ganacheProviderOptions.blockTime) {
        // If a blockTime is specified, we force mining a block now, as ganache doesn't do it automatically.
        ganache.sendAsync({"id": 1, "jsonrpc":"2.0", "method":"evm_mine", "params": []}, () => {});
    }

    // store an off-chain hashState
    const hashState = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("to the moon"));

    // trigger a dispute
    const account0Contract = channelContract.connect(provider.getSigner(account0));
    const tx = await account0Contract.triggerDispute();

    if (!!ganacheProviderOptions.blockTime) {
        // If a blockTime is specified, we force mining a block now, as ganache doesn't do it automatically.
        ganache.sendAsync({"id": 1, "jsonrpc":"2.0", "method":"evm_mine", "params": []}, () => {});
    }

    await tx.wait();

    return { ganache, provider, account0, account1, responderAccount, disputePeriod, channelContract, hashState };
}


// Repeated code for multiple tests
async function getTestData(provider, account0, account1, responderAccount, hashState, channelContract, disputePeriod) {
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
        signer, round, setStateHash, sig0, sig1, expiryPeriod, appointment, responseData
    };
}


// Commodity functions

//make a copy of the global time-related functions for tests that use sinon fake timers.
const _setTimeout = global.setTimeout;

// Save a snapshot of the state of the blockchain in ganache; resolves to the id of the snapshot
function takeGanacheSnapshot(ganache): Promise<string> {
    return new Promise(async (resolve, reject) => {
        ganache.sendAsync({"id": 1, "jsonrpc":"2.0", "method":"evm_snapshot", "params": []}, (err, res: any) => {
            if (err){
                console.log("WARNING: error while creating ganache snapshot");
                reject(err);
            } else {
                resolve(res.result);
            }
        });
    });
}

// Restores a previously saved snapshot given the id. Note: the id _cannot_ be reused
function restoreGanacheSnapshot(ganache, id: string) {
    return new Promise(async (resolve, reject) => {
        ganache.sendAsync({"id": 1, "jsonrpc":"2.0", "method":"evm_revert", "params": [id]}, (err, _) => {
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
function mineBlock(ganache, provider: ethers.providers.Web3Provider): Promise<number> {
    return new Promise(async (resolve, reject) => {
        const initialBlockNumber = await provider.getBlockNumber();

        ganache.sendAsync({"id": 1, "jsonrpc":"2.0", "method":"evm_mine", "params": []}, (err, _) => {
            if (err) reject(err);
        });

        const testBlockNumber = async function() {
            const blockNumber = await provider.getBlockNumber();
            if (blockNumber > initialBlockNumber){
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
    let ganache;
    let provider: ethers.providers.Web3Provider;

    let account0: string, account1: string, responderAccount: string;
    let disputePeriod: number, channelContract: ethers.Contract, hashState: string;

    const setup = async (ganacheOptions = {}) => {
        const d = await initTest(ganacheOptions);
        ganache = d.ganache;
        provider = d.provider;
        account0 = d.account0;
        account1 = d.account1;
        responderAccount = d.responderAccount;
        disputePeriod = d.disputePeriod;
        channelContract = d.channelContract;
        hashState = d.hashState;

        this.testData = await getTestData(provider, account0, account1, responderAccount, hashState, channelContract, disputePeriod);
    }

    beforeEach(async () => {
        await setup();
    });

    afterEach(async () => {
        sinon.restore();
    });

    it("correctly submits an appointment to the blockchain", async () => {
        const { signer, appointment, responseData } = this.testData;

        const responder = new EthereumDedicatedResponder(signer, new DoublingGasPolicy(provider), 40, 10);
        const promise = new Promise((resolve, reject) => {
            responder.on(ResponderEvent.ResponseSent, resolve);
            responder.on(ResponderEvent.AttemptFailed, reject)
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
    //     this.clock = sinon.useFakeTimers();

    //     const { signer, appointment, responseData } = this.testData;

    //     const nAttempts = 5;
    //     const responder = new EthereumDedicatedResponder(signer, new DoublingGasPolicy(provider), 40, nAttempts);

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
    //         this.clock.tick(tickWaitTime);
    //         await Promise.resolve();

    //         await waitFor(() => attemptFailedSpy.callCount > i);
    //     }

    //     // Let's make sure there is time after the last iteration
    //     this.clock.tick(tickWaitTime);
    //     await Promise.resolve();

    //     expect(attemptFailedSpy.callCount, "emitted AttemptFailed the right number of times").to.equal(nAttempts);
    //     expect(responseFailedSpy.callCount, "emitted ResponseFailed exactly once").to.equal(1);
    //     expect(responseSentSpy.called, "did not emit ResponseSent").to.be.false;
    //     expect(responseConfirmedSpy.called, "did not emit ResponseConfirmed").to.be.false;

    //     this.clock.restore();
    //     sinon.restore();
    // });

    it("emits the AttemptFailed with a NoNewBlockError if there is no new block for too long", async () => {
        this.clock = sinon.useFakeTimers({ shouldAdvanceTime: true });

        const { signer, appointment, responseData } = this.testData;

        const nAttempts = 1;
        const responder = new EthereumDedicatedResponder(signer, new DoublingGasPolicy(provider), 40, nAttempts);

        const attemptFailedSpy = sinon.spy();
        const responseFailedSpy = sinon.spy();
        const responseSentSpy = sinon.spy();
        const responseConfirmedSpy = sinon.spy();

        sinon.spy(signer, 'sendTransaction');

        responder.on(ResponderEvent.AttemptFailed, attemptFailedSpy);
        responder.on(ResponderEvent.ResponseFailed, responseFailedSpy);
        responder.on(ResponderEvent.ResponseSent, responseSentSpy);
        responder.on(ResponderEvent.ResponseConfirmed, responseConfirmedSpy);

        // Start the response flow
        responder.startResponse(appointment.id, responseData);

        // Wait for the response to be sent
        // We assume it will be done using the sendTransaction method on the signer
        await waitForSpy(signer.sendTransaction);

        // Wait for 1 second more than the deadline for throwing if no new blocks are seen
        this.clock.tick(1000 + EthereumDedicatedResponder.WAIT_TIME_FOR_NEW_BLOCK);

        await waitForSpy(attemptFailedSpy);

        // Check if the parameter of the attemptFailed event is an error of type NoNewBlockError
        const args = attemptFailedSpy.args[0]; //arguments of the first call
        expect(args[1] instanceof NoNewBlockError, "AttemptFailed emitted with NoNewBlockError").to.be.true;

        this.clock.restore();
        sinon.restore();
    });

    // TODO: this test currently passes but node complains with UnhandledPromiseRejectionWarning for Reorg (but exception is caught in the responder!)
    it("emits the AttemptFailed with a ReorgError if a re-org kicks out the transaction before enough confirmations", async () => {
        const { signer, appointment, responseData } = this.testData;

        const nAttempts = 1;
        const responder = new EthereumDedicatedResponder(signer, new DoublingGasPolicy(provider), 40, nAttempts);

        const attemptFailedSpy = sinon.spy();
        const responseFailedSpy = sinon.spy();
        const responseSentSpy = sinon.spy();
        const responseConfirmedSpy = sinon.spy();

        sinon.spy(signer, 'sendTransaction');

        responder.on(ResponderEvent.AttemptFailed, attemptFailedSpy);
        responder.on(ResponderEvent.ResponseFailed, responseFailedSpy);
        responder.on(ResponderEvent.ResponseSent, responseSentSpy);
        responder.on(ResponderEvent.ResponseConfirmed, responseConfirmedSpy);

        const snapshotId = await takeGanacheSnapshot(ganache);

        // Start the response flow
        responder.startResponse(appointment.id, responseData);

        // Wait for the response to be sent
        // We assume it will be done using the sendTransaction method on the signer
        await waitForSpy(signer.sendTransaction);

        await mineBlock(ganache, provider);

        // Simulate a reorg to a state prior to the transaction being mined
        await restoreGanacheSnapshot(ganache, snapshotId);

        await mineBlock(ganache, provider);

        await waitForSpy(attemptFailedSpy);

        // Check if the parameter of the attemptFailed event is an error of type NoNewBlockError
        const args = attemptFailedSpy.args[0]; //arguments of the first call
        expect(args[1] instanceof ReorgError, "AttemptFailed emitted with ReorgError").to.be.true;

        sinon.restore();
    });

    it("emits StuckTransactionError if WAIT_BLOCKS_BEFORE_RETRYING blocks are mined and the transaction is not included", async () => {
        // setup ganache so that blocks are created manually
        await setup({ blockTime: 10000 });

        const { signer, appointment, responseData } = this.testData;

        const nAttempts = 1;
        const responder = new EthereumDedicatedResponder(signer, new DoublingGasPolicy(provider), 40, nAttempts);

        const attemptFailedSpy = sinon.spy();
        const responseFailedSpy = sinon.spy();
        const responseSentSpy = sinon.spy();
        const responseConfirmedSpy = sinon.spy();

        sinon.spy(signer, 'sendTransaction');

        responder.on(ResponderEvent.AttemptFailed, attemptFailedSpy);
        responder.on(ResponderEvent.ResponseFailed, responseFailedSpy);
        responder.on(ResponderEvent.ResponseSent, responseSentSpy);
        responder.on(ResponderEvent.ResponseConfirmed, responseConfirmedSpy);


        // Start the response flow
        responder.startResponse(appointment.id, responseData);

        // Wait for the response to be sent and save the transaction
        const tx = await waitForSpy(signer.sendTransaction);

        const fakeTx = sinon.fake.returns(tx);

        // From now on, make attempts to sendTransaction and getTransactionReceipt return tx, so it looks like the transaction is not confirmed
        // TODO: it would be cleaner to prevent Ganache from mining the transaction.
        sinon.replace(signer, 'sendTransaction', fakeTx);
        sinon.replace(provider, 'getTransactionReceipt', sinon.fake.returns(tx));

        // Mine more than WAIT_BLOCKS_BEFORE_RETRYING blocks
        for (let i = 0; i < 1 + EthereumDedicatedResponder.WAIT_BLOCKS_BEFORE_RETRYING; i++) {
            await mineBlock(ganache, provider);
        }

        await waitForSpy(attemptFailedSpy);

        const args = attemptFailedSpy.args[0]; //arguments of the first call
        expect(args[1] instanceof StuckTransactionError, "AttemptFailed emitted with StuckTransactionError").to.be.true;

        sinon.restore();
    });

    // TODO: this test occasionally fails with timeout
    it("emits the ResponseSent event, followed by ResponseConfirmed after enough confirmations", async () => {
        const { signer, appointment, responseData } = this.testData;

        const nAttempts = 5;
        const nConfirmations = 5;
        const responder = new EthereumDedicatedResponder(signer, new DoublingGasPolicy(provider), nConfirmations, nAttempts);

        const attemptFailedSpy = sinon.spy();
        const responseFailedSpy = sinon.spy();
        const responseSentSpy = sinon.spy();
        const responseConfirmedSpy = sinon.spy();

        responder.on(ResponderEvent.AttemptFailed, attemptFailedSpy);
        responder.on(ResponderEvent.ResponseFailed, responseFailedSpy);
        responder.on(ResponderEvent.ResponseSent, responseSentSpy);
        responder.on(ResponderEvent.ResponseConfirmed, responseConfirmedSpy);

        sinon.spy(signer, 'sendTransaction');

        // Start the response flow
        responder.startResponse(appointment.id, responseData);

        // Wait for the response to be sent
        await waitForSpy(responseSentSpy);

        expect(responseSentSpy.called, "emitted ResponseSent").to.be.true;
        expect(responseConfirmedSpy.called, "did not emit ResponseConfirmed prematurely").to.be.false;

        // Now wait for enough confirmations
        for (let i = 0; i < nConfirmations; i++) {
            await mineBlock(ganache, provider);
        }

        // There might still be a short interval before the response is sent; we wait for the spy before continuing.
        await waitForSpy(responseConfirmedSpy);

        // Now the response is confirmed
        expect(responseConfirmedSpy.called, "emitted ResponseConfirmed").to.be.true;

        // No failed event should have been generated
        expect(attemptFailedSpy.called, "did not emit AttemptFailed").to.be.false;
        expect(responseFailedSpy.called, "did not emit ResponseFailed").to.be.false;

        sinon.restore();
    }).timeout(5000);
});
