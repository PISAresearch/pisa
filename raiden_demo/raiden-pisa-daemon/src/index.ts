import { SqliteListener } from "./sqlite-listener";
import { BalanceProofSigGroup, IRawBalanceProof } from "./balanceProof";
import { getWallet } from "./wallet";
import { PisaClient } from "./pisaClient";
import { IAppointmentRequest } from "./pisaClient";

const keyLocation =
    "/home/chris/.ethereum/keystore/UTC--2019-01-28T15-15-04.627735332Z--28df43df07cf4b545279918490d02453f4936e0d";
const password = "z+Ag)_Pm99&>>3ch";

const sqliteDbLocation = "/home/chris/.raiden/node_28df43df/netid_3/network_40a5d15f/v16_log.db";
const pisaHostAndPort = "localhost:5000";

const run = async () => {
    try {
        const wallet = await getWallet(keyLocation, password);
        const pisaClient = new PisaClient(pisaHostAndPort);

        const callback = async (bp: IRawBalanceProof) => {
            const sigGroup = BalanceProofSigGroup.fromBalanceProof(bp);
            const signedGroup = await sigGroup.sign(wallet);

            // bp.token_network_identifier,
            // bp.chain_id,


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
                    non_closing_signature: signedGroup,
                    nonce: sigGroup.nonce,
                    chain_id : sigGroup.chain_id,
                    token_network_identifier: sigGroup.token_network_identifier
                }
            };
            await pisaClient.requestAppointment(appointmentRequest);

        };

        const listener = new SqliteListener(500, sqliteDbLocation, callback);
        listener.start();
    } catch (doh) {
        console.error(doh);
    }
};

run();
