import * as chai from "chai";
import "mocha";
import chaiAsPromised from "chai-as-promised";
import request from "request-promise";
import { KitsuneTools } from "../external/kitsune/tools";
import { ethers } from "ethers";
import { PisaService } from "../../src/service";
import config from "../../src/dataEntities/config";
import Ganache from "ganache-core";
import { Appointment, IAppointmentRequest } from "../../src/dataEntities";
import levelup, { LevelUp } from "levelup";
import MemDown from "memdown";
import encodingDown from "encoding-down";
import { StatusCodeError } from "request-promise/errors";
chai.use(chaiAsPromised);

const ganache = Ganache.provider({
    mnemonic: "myth like bonus scare over problem client lizard pioneer submit female collect"
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

const provider = new ethers.providers.Web3Provider(ganache);
provider.pollingInterval = 100;

const expect = chai.expect;

const appointmentRequest = (data: string, acc: string, contractAddress: string, mode: number): IAppointmentRequest => {
    return {
        challengePeriod: 20,
        contractAddress,
        customerAddress: acc,
        data,
        endBlock: 22,
        eventABI: KitsuneTools.eventABI(),
        eventArgs: KitsuneTools.eventArgs(),
        gasLimit: "100000",
        id: 1,
        jobId: 0,
        mode,
        postCondition: "0x",
        refund: "0",
        startBlock: 0,
        paymentHash: Appointment.FreeHash
    };
};

describe("Service end-to-end", () => {
    let account0: string,
        account1: string,
        channelContract: ethers.Contract,
        oneWayChannelContract: ethers.Contract,
        hashState: string,
        disputePeriod: number,
        service: PisaService,
        db: LevelUp<encodingDown<string, any>>;

    beforeEach(async () => {
        const responderWallet = new ethers.Wallet(nextConfig.responderKey, provider);

        db = levelup(
            encodingDown<string, any>(MemDown(), {
                valueEncoding: "json"
            })
        );

        const signerWallet = new ethers.Wallet(nextConfig.receiptKey!, provider);
        signerWallet.connect(provider);
        const nonce = await responderWallet.getTransactionCount();

        service = new PisaService(
            nextConfig,
            provider,
            responderWallet,
            nonce,
            provider.network.chainId,
            signerWallet,
            db
        );
        await service.start();

        // accounts
        const accounts = await provider.listAccounts();
        account0 = accounts[0];
        account1 = accounts[1];

        // set the dispute period, greater than the inspector period
        disputePeriod = 11;

        // contract
        const channelContractFactory = new ethers.ContractFactory(
            KitsuneTools.ContractAbi,
            KitsuneTools.ContractBytecode,
            provider.getSigner()
        );
        // add the responder as a user, so that it's allowed to call trigger dispute
        oneWayChannelContract = await channelContractFactory.deploy([responderWallet.address], disputePeriod);
        channelContract = await channelContractFactory.deploy([account0, account1], disputePeriod);
        hashState = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("face-off"));
    });

    afterEach(async () => {
        await service.stop();
        await db.close();
    });

    it("service cannot be accessed during startup", async () => {
        const responderWallet = new ethers.Wallet(nextConfig.responderKey, provider);
        const signerWallet = new ethers.Wallet(nextConfig.receiptKey!, provider);
        const nonce = await responderWallet.getTransactionCount();

        const exService = new PisaService(
            { ...nextConfig, hostPort: nextConfig.hostPort + 1 },
            provider,
            responderWallet,
            nonce,
            provider.network.chainId,
            signerWallet,
            db
        );

        const round = 1;
        const setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address);
        const sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash));
        const sig1 = await provider.getSigner(account1).signMessage(ethers.utils.arrayify(setStateHash));
        const data = KitsuneTools.encodeSetStateData(hashState, round, sig0, sig1);
        const appRequest = appointmentRequest(data, account0, channelContract.address, 1);

        try {
            await request.post(`http://${nextConfig.hostName}:${nextConfig.hostPort + 1}/appointment`, {
                json: appRequest
            });

            chai.assert.fail();
        } catch (doh) {
            const statusCodeError = doh as StatusCodeError;
            expect(statusCodeError.statusCode).to.equal(503);
            expect(statusCodeError.error.message).to.equal("Service initialising, please try again later.");
        }

        await exService.start();
        await exService.stop();
    });

    const mineBlock = async (signer: ethers.Signer) => {
        const tx = await signer.sendTransaction({ to: "0x0000000000000000000000000000000000000000", value: 0 });
        await tx.wait();
    };

    it("create channel, submit appointment, trigger dispute, wait for response", async () => {
        const round = 1;
        const setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address);
        const sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash));
        const sig1 = await provider.getSigner(account1).signMessage(ethers.utils.arrayify(setStateHash));
        const data = KitsuneTools.encodeSetStateData(hashState, round, sig0, sig1);
        const appRequest = appointmentRequest(data, account0, channelContract.address, 1);

        const res = await request.post(`http://${nextConfig.hostName}:${nextConfig.hostPort}/appointment`, {
            json: appRequest
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

        try {
            // wait for the success result
            await waitForPredicate(successResult, s => s.success, 400);
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
        const appRequest = appointmentRequest(data, account0, channelContract.address, 1);

        const res = await request.post(`http://${nextConfig.hostName}:${nextConfig.hostPort}/appointment`, {
            json: appRequest
        });

        expect(
            request.post(`http://${nextConfig.hostName}:${nextConfig.hostPort}/appointment`, {
                json: appRequest
            })
        ).to.be.rejected;

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

        try {
            // wait for the success result
            await waitForPredicate(successResult, s => s.success, 400);
        } catch (doh) {
            // fail if we dont get it
            chai.assert.fail(true, false, "EventEvidence not successfully registered.");
        }
    }).timeout(3000);

    it("create channel, relay trigger dispute", async () => {
        const data = KitsuneTools.encodeTriggerDisputeData();
        const appRequest = appointmentRequest(data, account0, oneWayChannelContract.address, 0);

        const res = await request.post(`http://${nextConfig.hostName}:${nextConfig.hostPort}/appointment`, {
            json: appRequest
        });

        // now register a callback on the setstate event and trigger a response
        const triggerDisputeEvent = "EventDispute(uint256)";
        let successResult = { success: false };
        oneWayChannelContract.on(triggerDisputeEvent, async () => {
            oneWayChannelContract.removeAllListeners(triggerDisputeEvent);
            successResult.success = true;
        });

        try {
            // wait for the success result
            await waitForPredicate(successResult, s => s.success, 200);
        } catch (doh) {
            // fail if we dont get it
            chai.assert.fail(true, false, "EventEvidence not successfully registered.");
        }
    }).timeout(3000);

    it("create channel, relay twice throws error trigger dispute", async () => {
        const data = KitsuneTools.encodeTriggerDisputeData();
        const appRequest = appointmentRequest(data, account0, oneWayChannelContract.address, 0);

        const res = await request.post(`http://${nextConfig.hostName}:${nextConfig.hostPort}/appointment`, {
            json: appRequest
        });
        expect(
            request.post(`http://${nextConfig.hostName}:${nextConfig.hostPort}/appointment`, {
                json: appRequest
            })
        ).to.eventually.be.rejected;

        // now register a callback on the setstate event and trigger a response
        const triggerDisputeEvent = "EventDispute(uint256)";
        let successResult = { success: false };
        oneWayChannelContract.on(triggerDisputeEvent, async () => {
            oneWayChannelContract.removeAllListeners(triggerDisputeEvent);
            successResult.success = true;
        });

        try {
            // wait for the success result
            await waitForPredicate(successResult, s => s.success, 200);
        } catch (doh) {
            // fail if we dont get it
            chai.assert.fail(true, false, "EventEvidence not successfully registered.");
        }
    }).timeout(3000);

    // it("contains 'appointment' and 'signature' in the response; signature is correct", async () => {
    //     const round = 1,
    //         setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address),
    //         sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash)),
    //         sig1 = await provider.getSigner(account1).signMessage(ethers.utils.arrayify(setStateHash)),
    //         expiryPeriod = disputePeriod + 1;
    //     const appointment = {
    //         expiryPeriod,
    //         type: ChannelType.Kitsune,
    //         stateUpdate: {
    //             contractAddress: channelContract.address,
    //             hashState,
    //             round,
    //             signatures: [sig0, sig1]
    //         }
    //     };

    //     const startBlock = await provider.getBlockNumber();
    //     const endBlock = startBlock + appointment.expiryPeriod;

    //     const res = await request.post(`http://${nextConfig.hostName}:${nextConfig.hostPort}/appointment`, {
    //         json: appointment
    //     });

    //     const packedData = ethers.utils.solidityPack(
    //         ["string", "uint", "uint", "uint"],
    //         [
    //             channelContract.address, // locator===address in Kitsune
    //             appointment.stateUpdate.round,
    //             startBlock,
    //             endBlock
    //         ]
    //     );
    //     const digest = ethers.utils.keccak256(packedData);
    //     const signer = new ethers.Wallet(nextConfig.receiptKey!);
    //     const sig = await signer.signMessage(digest);

    //     expect(res).to.deep.equal({
    //         startBlock: startBlock,
    //         endBlock: endBlock,
    //         locator: channelContract.address,
    //         nonce: appointment.stateUpdate.round,
    //         signature: sig
    //     });
    // });

    // it("create channel, submit round = 0 too low returns 400", async () => {
    //     const round = 0,
    //         setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address),
    //         sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash)),
    //         sig1 = await provider.getSigner(account1).signMessage(ethers.utils.arrayify(setStateHash)),
    //         expiryPeriod = disputePeriod + 1;
    //     const appointment = {
    //         expiryPeriod,
    //         type: ChannelType.Kitsune,
    //         stateUpdate: {
    //             contractAddress: channelContract.address,
    //             hashState,
    //             round,
    //             signatures: [sig0, sig1]
    //         }
    //     };

    //     await failWithCode('400 - "Supplied appointment round', appointment);
    // }).timeout(3000);

    // it("create channel, submit round = -1 too low returns 400", async () => {
    //     const round = -1,
    //         setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address),
    //         sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash)),
    //         sig1 = await provider.getSigner(account1).signMessage(ethers.utils.arrayify(setStateHash)),
    //         expiryPeriod = disputePeriod + 1;
    //     const appointment = {
    //         expiryPeriod,
    //         type: ChannelType.Kitsune,
    //         stateUpdate: {
    //             contractAddress: channelContract.address,
    //             hashState,
    //             round,
    //             signatures: [sig0, sig1]
    //         }
    //     };

    //     await failWithCode('400 - "Supplied appointment round', appointment);
    // }).timeout(3000);

    // it("create channel, expiry = dispute period returns 400", async () => {
    //     const round = 1,
    //         setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address),
    //         sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash)),
    //         sig1 = await provider.getSigner(account1).signMessage(ethers.utils.arrayify(setStateHash)),
    //         expiryPeriod = disputePeriod;
    //     const appointment = {
    //         expiryPeriod,
    //         type: ChannelType.Kitsune,
    //         stateUpdate: {
    //             contractAddress: channelContract.address,
    //             hashState,
    //             round,
    //             signatures: [sig0, sig1]
    //         }
    //     };

    //     await failWithCode('400 - "Supplied appointment expiryPeriod', appointment);
    // }).timeout(3000);

    // it("create channel, expiry period = dispute period - 1 too low returns 400", async () => {
    //     const round = 1,
    //         setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address),
    //         sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash)),
    //         sig1 = await provider.getSigner(account1).signMessage(ethers.utils.arrayify(setStateHash)),
    //         expiryPeriod = disputePeriod - 1;
    //     const appointment = {
    //         expiryPeriod,
    //         type: ChannelType.Kitsune,
    //         stateUpdate: {
    //             contractAddress: channelContract.address,
    //             hashState,
    //             round,
    //             signatures: [sig0, sig1]
    //         }
    //     };

    //     await failWithCode('400 - "Supplied appointment expiryPeriod', appointment);
    // }).timeout(3000);

    // it("create channel, non existant contact returns 400", async () => {
    //     const round = 1,
    //         setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address),
    //         sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash)),
    //         sig1 = await provider.getSigner(account1).signMessage(ethers.utils.arrayify(setStateHash)),
    //         expiryPeriod = disputePeriod + 1;
    //     const appointment = {
    //         expiryPeriod,
    //         type: ChannelType.Kitsune,
    //         stateUpdate: {
    //             // random address
    //             contractAddress: "0x4bf3A7dFB3b76b5B3E169ACE65f888A4b4FCa5Ee",
    //             hashState,
    //             round,
    //             signatures: [sig0, sig1]
    //         }
    //     };

    //     await failWithCode(`400 - "No code found at address ${appointment.stateUpdate.contractAddress}`, appointment);
    // }).timeout(3000);

    // it("create channel, wrong bytecode contact returns 400", async () => {
    //     // deply an unrelated contract with different bytecode

    //     // contract
    //     const channelContractFactoryFactory = new ethers.ContractFactory(
    //         StateChannelFactory.abi,
    //         StateChannelFactory.bytecode,
    //         provider.getSigner()
    //     );
    //     const channelFactoryContract = await channelContractFactoryFactory.deploy();

    //     const round = 1,
    //         setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address),
    //         sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash)),
    //         sig1 = await provider.getSigner(account1).signMessage(ethers.utils.arrayify(setStateHash)),
    //         expiryPeriod = disputePeriod + 1;
    //     const appointment = {
    //         expiryPeriod,
    //         type: ChannelType.Kitsune,
    //         stateUpdate: {
    //             // random address
    //             contractAddress: channelFactoryContract.address,
    //             hashState,
    //             round,
    //             signatures: [sig0, sig1]
    //         }
    //     };

    //     await failWithCode(
    //         `400 - "Contract at: ${appointment.stateUpdate.contractAddress} does not have correct bytecode.`,
    //         appointment
    //     );
    // }).timeout(3000);

    // it("create channel, invalid contract address returns 400", async () => {
    //     const round = 1,
    //         setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address),
    //         sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash)),
    //         sig1 = await provider.getSigner(account1).signMessage(ethers.utils.arrayify(setStateHash)),
    //         expiryPeriod = disputePeriod + 1;
    //     const appointment = {
    //         expiryPeriod,
    //         type: ChannelType.Kitsune,
    //         stateUpdate: {
    //             // invalid address
    //             contractAddress: "0x4bf3A7dFB3b76b",
    //             hashState,
    //             round,
    //             signatures: [sig0, sig1]
    //         }
    //     };

    //     await failWithCode(`400 - "${appointment.stateUpdate.contractAddress} is not a valid address.`, appointment);
    // }).timeout(3000);

    // it("create channel, invalid state hash returns 400", async () => {
    //     const round = 1,
    //         setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address),
    //         sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash)),
    //         sig1 = await provider.getSigner(account1).signMessage(ethers.utils.arrayify(setStateHash)),
    //         expiryPeriod = disputePeriod + 1;
    //     const appointment = {
    //         expiryPeriod,
    //         type: ChannelType.Kitsune,
    //         stateUpdate: {
    //             contractAddress: channelContract.address,
    //             // invalid hash state
    //             hashState: "0x4bf3A7dFB3b76b",
    //             round,
    //             signatures: [sig0, sig1]
    //         }
    //     };

    //     await failWithCode(`400 - "Invalid bytes32: ${appointment.stateUpdate.hashState}`, appointment);
    // }).timeout(3000);

    // it("create channel, wrong state hash returns 400", async () => {
    //     const round = 1,
    //         setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address),
    //         sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash)),
    //         sig1 = await provider.getSigner(account1).signMessage(ethers.utils.arrayify(setStateHash)),
    //         expiryPeriod = disputePeriod + 1;
    //     const appointment = {
    //         expiryPeriod,
    //         type: ChannelType.Kitsune,
    //         stateUpdate: {
    //             contractAddress: channelContract.address,
    //             // substute the state hash for the set state hash
    //             hashState: setStateHash,
    //             round,
    //             signatures: [sig0, sig1]
    //         }
    //     };

    //     await failWithCode(
    //         '400 - "Party 0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1 not present in signatures',
    //         appointment
    //     );
    // }).timeout(3000);

    // it("create channel, wrong sig on hash returns 400", async () => {
    //     const expiryPeriod = disputePeriod + 1,
    //         round = 1,
    //         // setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address),
    //         // sign the wrong hash
    //         sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(hashState)),
    //         sig1 = await provider.getSigner(account1).signMessage(ethers.utils.arrayify(hashState));
    //     const appointment = {
    //         expiryPeriod,
    //         type: ChannelType.Kitsune,
    //         stateUpdate: {
    //             contractAddress: channelContract.address,
    //             hashState,
    //             round,
    //             signatures: [sig0, sig1]
    //         }
    //     };

    //     await failWithCode(
    //         '400 - "Party 0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1 not present in signatures',
    //         appointment
    //     );
    // }).timeout(3000);

    // it("create channel, sigs by only one player returns 400", async () => {
    //     const expiryPeriod = disputePeriod + 1,
    //         round = 1,
    //         setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address),
    //         // sign both with account 0
    //         sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash)),
    //         sig1 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash));

    //     const appointment = {
    //         expiryPeriod,
    //         type: ChannelType.Kitsune,
    //         stateUpdate: {
    //             contractAddress: channelContract.address,
    //             hashState,
    //             round,
    //             signatures: [sig0, sig1]
    //         }
    //     };

    //     await failWithCode(
    //         '400 - "Party 0xFFcf8FDEE72ac11b5c542428B35EEF5769C409f0 not present in signatures',
    //         appointment
    //     );
    // }).timeout(3000);

    // it("create channel, missing sig returns 400", async () => {
    //     const expiryPeriod = disputePeriod + 1,
    //         round = 1,
    //         setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address),
    //         //sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash)),
    //         sig1 = await provider.getSigner(account1).signMessage(ethers.utils.arrayify(setStateHash));

    //     const appointment = {
    //         expiryPeriod,
    //         type: ChannelType.Kitsune,
    //         stateUpdate: {
    //             contractAddress: channelContract.address,
    //             hashState,
    //             round,
    //             signatures: [sig1]
    //         }
    //     };

    //     await failWithCode('400 - "Incorrect number of signatures supplied', appointment);
    // }).timeout(3000);

    // it("create channel, sigs in wrong order returns 200", async () => {
    //     const round = 1,
    //         setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address),
    //         sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash)),
    //         sig1 = await provider.getSigner(account1).signMessage(ethers.utils.arrayify(setStateHash)),
    //         expiryPeriod = disputePeriod + 1;
    //     const appointment = {
    //         expiryPeriod,
    //         type: ChannelType.Kitsune,
    //         stateUpdate: {
    //             contractAddress: channelContract.address,
    //             hashState,
    //             round,
    //             signatures: [sig0, sig1]
    //         }
    //     };
    //     try {
    //         await request.post(`http://${nextConfig.hostName}:${nextConfig.hostPort}/appointment`, {
    //             json: appointment
    //         });
    //     } catch (doh) {
    //         chai.assert.fail();
    //     }
    // }).timeout(3000);

    const failWithCode = async (errorMessage: string, appointment: any) => {
        try {
            await request.post(`http://${nextConfig.hostName}:${nextConfig.hostPort}/appointment`, {
                json: appointment
            });
            chai.assert.fail(true, false, "Request was successful when it should have failed.");
        } catch (doh) {
            if (doh instanceof Error && doh.message.startsWith(errorMessage)) {
                // success
            } else if (doh instanceof Error) {
                chai.assert.fail(true, false, doh.message);
            } else chai.assert.fail(true, false, doh);
        }
    };
});

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
