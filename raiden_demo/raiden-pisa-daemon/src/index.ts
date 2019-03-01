import { SqliteListener } from "./sqlite-listener";
import { BalanceProofSigGroup, IRawBalanceProof } from "./balanceProof";
import { getWallet } from "./wallet";
import { PisaClient } from "./pisaClient";
import { IAppointmentRequest } from "./pisaClient";
import { ethers } from "ethers";

const keyLocation =
    "/home/chris/.ethereum/keystore/UTC--2019-01-30T12-27-45.607500912Z--f0afbed24d88ce4cb12828984bb10d2f1ad0e185";
//const password = "z+Ag)_Pm99&>>3ch";
const password = "]7k.t?/P]B.\\6J>`";

const sqliteDbLocation = "/home/chris/.raiden/node_f0afbed2/netid_3/network_40a5d15f/v16_log.db";
const pisaHostAndPort = "localhost:3000";


const run = async (startingId: number) => {
    try {
        const wallet = await getWallet(keyLocation, password);
        const pisaClient = new PisaClient(pisaHostAndPort);

        const callback = async (bp: IRawBalanceProof) => {
            console.log("update detected")
            const sigGroup = BalanceProofSigGroup.fromBalanceProof(bp);
            const nonClosingHash = sigGroup.packForNonCloser();

            const nonClosingSig = await sigGroup.sign(nonClosingHash, wallet);
            console.log("signed", wallet.address);
            console.log("verified", ethers.utils.verifyMessage(ethers.utils.arrayify(nonClosingHash), nonClosingSig));

            const appointmentRequest: IAppointmentRequest = {
                // settlement is 500, so lets take 20 of those
                expiryPeriod: 10000,
                stateUpdate: {
                    additional_hash: sigGroup.additional_hash,
                    balance_hash: sigGroup.balance_hash,
                    channel_identifier: sigGroup.channel_identifier,
                    closing_participant: bp.sender, // the sender since it wont be us that closes - pisa won't respond if we close
                    closing_signature: sigGroup.closing_signature,
                    non_closing_participant: wallet.address, // us
                    non_closing_signature: nonClosingSig,
                    nonce: sigGroup.nonce,
                    chain_id : sigGroup.chain_id,
                    token_network_identifier: sigGroup.token_network_identifier
                }
            };
            console.log(appointmentRequest)
            await pisaClient.requestRaidenAppointment(appointmentRequest);

        };

        const listener = new SqliteListener(5000, sqliteDbLocation, startingId, callback);
        listener.start();

        console.log("listening for updates...")
    } catch (doh) {
        console.error(doh);
    }
};

run(0);