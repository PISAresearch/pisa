import * as chai from "chai";
import * as sinon from "sinon";
import "mocha";
import { ethers } from "ethers";
import Ganache from "ganache-core";
import { KitsuneAppointment, KitsuneInspector, KitsuneTools } from "../../src/integrations/kitsune";
import { EthereumDedicatedResponder, ResponderEvent, NoNewBlockError } from "../../src/responder";
import { ChannelType } from "../../src/dataEntities";
import chaiAsPromised from "chai-as-promised";

const ganache = Ganache.provider({
    mnemonic: "myth like bonus scare over problem client lizard pioneer submit female collect"
});
const provider: ethers.providers.Web3Provider = new ethers.providers.Web3Provider(ganache);
provider.pollingInterval = 100;

chai.use(chaiAsPromised);
chai.use(require('sinon-chai'));

const expect = chai.expect;

describe("DedicatedEthereumResponder", () => {
    let account0: string, account1: string, channelContract: ethers.Contract, hashState: string, disputePeriod: number;
    let responderAccount: string;

    let initialSnapshotId: string;

    // Save a snapshot of the state of the blockchain in ganache; resolves to the id of the snapshot
    function takeGanacheSnapshot(): Promise<string> {
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
    function restoreGanacheSnapshot(id: string) {
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
    function mineBlock() {
        return new Promise(async (resolve, reject) => {
            const initialBlockNumber = await provider.getBlockNumber();

            ganache.sendAsync({"id": 1, "jsonrpc":"2.0", "method":"evm_mine", "params": []}, (err, _) => {
                if (err) reject(err);
            });

            const testBlockNumber = async function() {
                if (await provider.getBlockNumber() > initialBlockNumber){
                    resolve();
                } else {
                    setTimeout(testBlockNumber, 20);
                }
            };
            setTimeout(testBlockNumber, 20);
        });
    }

    // Returns a promise that waits for a sinon spy to be called and resolves to the return value of the first call.
    function waitForSpy(spy: any) {
        return new Promise( resolve => {
            const testSpy = function() {
                if (spy.called) {
                    resolve(spy.getCall(0).returnValue);
                }
                setTimeout(testSpy, 20);
            };
            testSpy();
        });
    }

    before(async () => {
        // Set up the accounts
        const accounts = await provider.listAccounts();
        account0 = accounts[0];
        account1 = accounts[1];
        responderAccount = accounts[3];

        // set the dispute period
        disputePeriod = 11;

        // deploy the contract
        const channelContractFactory = new ethers.ContractFactory(
            KitsuneTools.ContractAbi,
            KitsuneTools.ContractBytecode,
            provider.getSigner()
        );
        channelContract = await channelContractFactory.deploy([account0, account1], disputePeriod);

        // store an off-chain hashState
        hashState = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("to the moon"));

        // trigger a dispute
        const account0Contract = channelContract.connect(provider.getSigner(account0));
        const tx = await account0Contract.triggerDispute();
        await tx.wait();
    });

    beforeEach(async () => {
        // The block number at the beginning of the test should be equal to 2.
        // There are occasional failures happening that seem to be due to incorrect restoring of the snapshot in ganache.
        // For now we at least provide an approprate error message.
        // TODO: find out how to get reliable snapshots.
        const blockNumber = await provider.getBlockNumber();
        if (blockNumber != 2) {
            console.log(`WARNING: Sarting test with block #${blockNumber}. It should be 2 instead. Snapshot might be incorrectly restored. Tests will probably fail.`);
        }

        initialSnapshotId = await takeGanacheSnapshot();

        const newBlockNumber = await provider.getBlockNumber();
        if (newBlockNumber != 2) {
            console.log(`WARNING: blockNumber is ${newBlockNumber} right after taking the snapshot. This should not happen.`);
        }

    });

    // Restore the initial snapshot for the next test
    afterEach(async () => {
        sinon.restore();

        // Without this, the revert to the snapshot seems to occasionally fail.
        // TODO: figure out the reason.
        await provider.getBlockNumber();

        await restoreGanacheSnapshot(initialSnapshotId);

        const blockNumber = await provider.getBlockNumber();
        if (blockNumber != 2) {
            console.log(`WARNING: block number is ${blockNumber} after evm_revert. It should be 2.`);
        }
    });


    // Repeated code for multiple tests
    async function getTestData() {
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


    it("correctly submits an appointment to the blockchain", async () => {
        const { signer, appointment, responseData } = await getTestData();

        const responder = new EthereumDedicatedResponder(signer, appointment.id, responseData, 10);
        const promise = new Promise((resolve, reject)=> {
            responder.on(ResponderEvent.ResponseSent, resolve);
            responder.on(ResponderEvent.AttemptFailed, reject)
        });

        responder.respond();

        await promise; // Make sure the ResponseSent event is generated

        // Test if the channel hashed state has been updated
        const channelState = await channelContract.hstate();
        expect(channelState).to.equal(hashState);
    });

    it("emits the AttemptFailed and ResponseFailed events the correct number of times on failure", async () => {
        this.clock = sinon.useFakeTimers({ shouldAdvanceTime: true });

        const { signer, appointment, responseData } = await getTestData();

        const nAttempts = 5;
        const responder = new EthereumDedicatedResponder(signer, appointment.id, responseData, 40, nAttempts);

        const attemptFailedSpy = sinon.spy();
        const responseFailedSpy = sinon.spy();
        const responseSentSpy = sinon.spy();
        const responseConfirmedSpy = sinon.spy();

        // Make sendTransaction return promises that never resolve
        sinon.replace(signer, 'sendTransaction', () => new Promise(() => {}));

        responder.on(ResponderEvent.AttemptFailed, attemptFailedSpy);
        responder.on(ResponderEvent.ResponseFailed, responseFailedSpy);
        responder.on(ResponderEvent.ResponseSent, responseSentSpy);
        responder.on(ResponderEvent.ResponseConfirmed, responseConfirmedSpy);

        // Start the response flow
        responder.respond();

        const tickWaitTime = 1000 + EthereumDedicatedResponder.WAIT_TIME_FOR_PROVIDER_RESPONSE + EthereumDedicatedResponder.WAIT_TIME_BETWEEN_ATTEMPTS;
        // The test seems to fail if we make time steps that are too large; instead, we proceed at 1 second ticks
        for (let i = 0; i < nAttempts * tickWaitTime/1000; i++) {
            this.clock.tick(tickWaitTime * 1000);
            await Promise.resolve();
        }

        // Let's make sure there is time after the last iteration
        this.clock.tick(tickWaitTime);
        await Promise.resolve();

        expect(attemptFailedSpy.callCount, "emitted AttemptFailed the right number of times").to.equal(nAttempts);
        expect(responseFailedSpy.callCount, "emitted ResponseFailed exactly once").to.equal(1);
        expect(responseSentSpy.called, "did not emit ResponseSent").to.be.false;
        expect(responseConfirmedSpy.called, "did not emit ResponseConfirmed").to.be.false;

        this.clock.restore();
        sinon.restore();
    });

    it("emits the AttemptFailed with a NoNewBlockError if there is no new block for too long", async () => {
        this.clock = sinon.useFakeTimers({ shouldAdvanceTime: true });

        const { signer, appointment, responseData } = await getTestData();

        const nAttempts = 1;
        const responder = new EthereumDedicatedResponder(signer, appointment.id, responseData, 40, nAttempts);

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
        responder.respond();

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

    it("emits the ResponseSent event, followed by ResponseConfirmed after enough confirmations", async () => {
        const { signer, appointment, responseData } = await getTestData();

        const nAttempts = 5;
        const nConfirmations = 5;
        const responder = new EthereumDedicatedResponder(signer, appointment.id, responseData, nConfirmations, nAttempts);

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
        responder.respond();

        // Wait for the response to be sent
        await waitForSpy(responseSentSpy);

        expect(responseSentSpy.called, "emitted ResponseSent").to.be.true;
        expect(responseConfirmedSpy.called, "did not emit ResponseConfirmed prematurely").to.be.false;

        // Now wait for enough confirmations
        for (let i = 0; i < nConfirmations; i++) {
            await mineBlock();
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
