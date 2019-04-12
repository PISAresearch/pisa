import * as chai from "chai";
import "mocha";
import { ethers } from "ethers";
import Ganache from "ganache-core";
import { KitsuneAppointment, KitsuneInspector, KitsuneTools } from "../../src/integrations/kitsune";
import { EthereumDedicatedResponder, ResponderEvent } from "../../src/responder";
import { ChannelType } from "../../src/dataEntities";
import chaiAsPromised from "chai-as-promised";
const ganache = Ganache.provider({
    mnemonic: "myth like bonus scare over problem client lizard pioneer submit female collect"
});
const provider: ethers.providers.Web3Provider = new ethers.providers.Web3Provider(ganache);
provider.pollingInterval = 100;

chai.use(chaiAsPromised);
const expect = chai.expect;

describe("DedicatedEthereumResponder", () => {
    let account0: string, account1: string, channelContract: ethers.Contract, hashState: string, disputePeriod: number;
    let responderAccount: string;

    let initialSnapshotId: string;

    // Save a snapshot of the state of the blockchain in ganache; resolves to the id of the snapshot
    async function takeGanacheSnapshot(): Promise<string> {
        return await new Promise(async (resolve, reject) => {
            ganache.sendAsync({"id": 1, "jsonrpc":"2.0", "method":"evm_snapshot", "params": []}, (err, res: any) => {
                if (err) reject(err); else resolve(res.result);
            });
        });
    }

    // Restores a previously saved snapshot given the id. Note: the id _cannot_ be reused
    async function restoreGanacheSnapshot(id: string) {
        await new Promise(async (resolve, reject) => {
            ganache.sendAsync({"id": 1, "jsonrpc":"2.0", "method":"evm_revert", "params": [id]}, (err, _) => {
                if (err) reject(err); else resolve();
            });
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

        // Make a snapshot of the blockchain for re-using it in many tests
        initialSnapshotId = await takeGanacheSnapshot();
    });

    // Restore the initial snapshot for the next test
    afterEach(async () => {
        await restoreGanacheSnapshot(initialSnapshotId);
        initialSnapshotId = await takeGanacheSnapshot();
    });



    it("correctly submits an appointment to the blockchain", async () => {
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

        const response = appointment.getResponse();

        const responder = new EthereumDedicatedResponder(signer, appointment.id, response, 10);
        const promise = new Promise((resolve, reject)=> {
            responder.on(ResponderEvent.ResponseSent, resolve);
            responder.on(ResponderEvent.AttemptFailed, reject)
        });

        responder.respond();

        await promise;
    });
});
