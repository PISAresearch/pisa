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
import { deployPisa } from "./utils/contract";
import { keccak256, defaultAbiCoder, arrayify } from "ethers/utils";
import { wait } from "../../src/utils";
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

const provider = new ethers.providers.Web3Provider(ganache);
provider.pollingInterval = 100;

const expect = chai.expect;

const appointmentRequest = async (
    data: string,
    contractAddress: string,
    mode: number,
    customer: ethers.Signer,
    customerAddress: string,
    startBlock: number,
    pisaContractAddress: string
): Promise<IAppointmentRequest> => {
    const bareAppointment = {
        challengePeriod: 100,
        contractAddress,
        customerAddress: customerAddress,
        data,
        endBlock: 1000,
        eventAddress: contractAddress,
        eventABI: KitsuneTools.eventABI(),
        eventArgs: KitsuneTools.eventArgs(),
        gasLimit: 1000000,
        id: "0x0000000000000000000000000000000000000000000000000000000000000001",
        nonce: 0,
        mode,
        preCondition: "0x",
        postCondition: "0x",
        refund: "0",
        startBlock,
        paymentHash: Appointment.FreeHash,
        customerSig: "0x"
    };

    const app = Appointment.parse(bareAppointment);
    const hashedWithAddress = keccak256(app.encodeForSig(pisaContractAddress));

    const sig = await customer.signMessage(arrayify(hashedWithAddress));

    return {
        ...Appointment.toIAppointmentRequest(app),
        customerSig: sig,
        refund: app.refund.toString(),
        gasLimit: app.gasLimit
    };
};

describe("Service end-to-end", () => {
    let account0: string,
        account1: string,
        wallet0: ethers.Signer,
        wallet1: ethers.Signer,
        channelContract: ethers.Contract,
        oneWayChannelContract: ethers.Contract,
        hashState: string,
        disputePeriod: number,
        service: PisaService,
        db: LevelUp<encodingDown<string, any>>,
        pisaContractAddress: string;

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
        wallet1 = provider.getSigner(account0);
        account1 = accounts[1];

        // set the dispute period, greater than the inspector period
        disputePeriod = 11;

        // contract
        const channelContractFactory = new ethers.ContractFactory(KitsuneTools.ContractAbi, KitsuneTools.ContractBytecode, provider.getSigner());
        // add the responder as a user, so that it's allowed to call trigger dispute
        oneWayChannelContract = await channelContractFactory.deploy([pisaContractAddress], disputePeriod);
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

        const round = 1;
        const setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address);
        const sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash));
        const sig1 = await provider.getSigner(account1).signMessage(ethers.utils.arrayify(setStateHash));
        const data = KitsuneTools.encodeSetStateData(hashState, round, sig0, sig1);
        const currentBlockNumber = await provider.getBlockNumber();
        const appRequest = await appointmentRequest(data, channelContract.address, 1, wallet0, account0, currentBlockNumber, pisaContractAddress);

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
        const currentBlockNumber = await provider.getBlockNumber();
        const appRequest = await appointmentRequest(data, channelContract.address, 1, wallet0, account0, currentBlockNumber, pisaContractAddress);

        const res = await request.post(`http://${nextConfig.hostName}:${nextConfig.hostPort}/appointment`, {
            json: appRequest
        });

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
        const appRequest = await appointmentRequest(data, channelContract.address, 1, wallet0, account0, currentBlockNumber, pisaContractAddress);

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
        const appRequest = await appointmentRequest(data, oneWayChannelContract.address, 0, wallet0, account0, currentBlockNumber, pisaContractAddress);

        // now register a callback on the setstate event and trigger a response
        const triggerDisputeEvent = "EventDispute(uint256)";
        let success = false;
        oneWayChannelContract.once(triggerDisputeEvent, async () => (success = true));

        const res = await request.post(`http://${nextConfig.hostName}:${nextConfig.hostPort}/appointment`, {
            json: appRequest
        });

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
        const appRequest = await appointmentRequest(data, oneWayChannelContract.address, 0, wallet0, account0, currentBlockNumber, pisaContractAddress);

        // now register a callback on the setstate event and trigger a response
        const triggerDisputeEvent = "EventDispute(uint256)";
        let success = false;
        oneWayChannelContract.once(triggerDisputeEvent, async () => (success = true));

        const res = await request.post(`http://${nextConfig.hostName}:${nextConfig.hostPort}/appointment`, {
            json: appRequest
        });
        expect(
            request.post(`http://${nextConfig.hostName}:${nextConfig.hostPort}/appointment`, {
                json: appRequest
            })
        ).to.eventually.be.rejected;

        try {
            // wait for the success result
            await waitForPredicate(() => success, 50, 20);
        } catch (doh) {
            // fail if we dont get it
            chai.assert.fail(true, false, "EventDispute not successfully registered.");
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
