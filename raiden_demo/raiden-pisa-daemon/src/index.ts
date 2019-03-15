import { SqliteListener } from "./sqlite-listener";
import { BalanceProofSigGroup, IRawBalanceProof } from "./balanceProof";
import { getWallet } from "./wallet";
import { PisaClient } from "./pisaClient";
import { IAppointmentRequest } from "./pisaClient";

const argv = require('yargs')
    .scriptName("raiden-pisa-daemon")
    .usage('$0 [args]')
    .demandOption(['keyfile'])
    .describe('keyfile', 'The location of the keyfile')
    .alias('password', 'p')
    .demandOption(['password'])
    .describe('password', 'The password of the keyfile')
    .demandOption(['pisa'])
    .describe('pisa', 'host:port of pisa service')
    .demandOption(['db'])
    .describe('db', 'The location of the raiden db instance that is hiring pisa')
    .describe('startId', 'Tells the daemon to start processing raiden db from this row id onward')
    .default('startId', null)
    .help()
    .argv;


const run = async (startingRowId: number) => {
    try {
        const wallet = await getWallet(argv.keyfile, argv.password);
        const pisaClient = new PisaClient(argv.pisa);

        const callback = async (bp: IRawBalanceProof) => {
            const sigGroup = BalanceProofSigGroup.fromBalanceProof(bp);
            const nonClosingHash = sigGroup.packForNonCloser();

            const nonClosingSig = await sigGroup.sign(nonClosingHash, wallet);
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

        const listener = new SqliteListener(10000, argv.db, startingRowId, callback);
        listener.start();

        console.log("listening for updates...")
    } catch (err) {
        console.error(err);
    }
};

run(argv.startId);