import * as fs from "fs";

import { SqliteListener } from "./sqlite-listener";
import { BalanceProofSigGroup, IRawBalanceProof } from "./balanceProof";
import { getWallet } from "./wallet";
import { PisaClient } from "./pisaClient";
import { RaidenTools } from "./tools";
import { ethers } from "ethers";
import { keccak256 } from "ethers/utils";

const argv = require("yargs")
    .scriptName("raiden-pisa-daemon")
    .usage("$0 [args]")
    .demandOption(["keyfile"])
    .describe("keyfile", "The location of the keyfile")
    .alias("password-file", "p")
    .demandOption(["password-file"])
    .describe("password-file", "The password-file (NOT the password!) of the keyfile")
    .demandOption(["pisa"])
    .describe("pisa", "host:port of pisa service")
    .demandOption(["db"])
    .describe("db", "The location of the raiden db instance that is hiring pisa")
    .describe("startId", "Tells the daemon to start processing raiden db from this row id onward")
    .default("startId", null)
    .help().argv;

const run = async (startingRowId: number) => {
    try {
        const password = fs
            .readFileSync(argv.passwordFile)
            .toString()
            .trim();
        const wallet = await getWallet(argv.keyfile, password);
        const pisaClient = new PisaClient(argv.pisa);

        const callback = async (bp: IRawBalanceProof) => {
            const sigGroup = BalanceProofSigGroup.fromBalanceProof(bp);
            const nonClosingHash = sigGroup.packForNonCloser();
            const nonClosingSig = await sigGroup.sign(nonClosingHash, wallet);
            const encodedForUpdate = RaidenTools.encodeForUpdate(
                sigGroup.channel_identifier,
                bp.sender,
                wallet.address,
                sigGroup.balance_hash,
                sigGroup.nonce,
                sigGroup.additional_hash,
                sigGroup.closing_signature,
                nonClosingSig
            );

            const request = {
                challengePeriod: 200,
                contractAddress: sigGroup.token_network_identifier,
                customerAddress: wallet.address,
                data: encodedForUpdate,
                endBlock: 10000,
                eventABI: RaidenTools.eventABI(),
                eventArgs: RaidenTools.eventArgs(sigGroup.channel_identifier, bp.sender),
                gasLimit: "200000",
                id: 1,
                jobId: 0,
                mode: 1,
                preCondition: "0x",
                postCondition: "0x",
                refund: "0",
                startBlock: 0,
                paymentHash: ethers.utils.keccak256(ethers.utils.toUtf8Bytes("on-the-house")),
                customerSig: "0x"
            };
            console.log(request);
            const encoded = encode(request);
            const sig = await wallet.signMessage(encoded);
            request.customerSig = sig;
            console.log(request);
            await pisaClient.requestAppointment(request);
        };

        const listener = new SqliteListener(10000, argv.db, startingRowId, callback);
        listener.start();

        console.log("listening for updates...");
    } catch (err) {
        console.error(err);
    }
};

function groupTuples(tupleArray: [string, any][]): [string[], any[]] {
    return tupleArray.reduce(
        // for some reason the ts compiler wont accept the proper types here
        // so we have to use 'any' instead of [string[], any[]] for 'prev'
        (prev: any, cur: [string, any]) => {
            prev[0].push(cur[0]);
            prev[1].push(cur[1]);
            return prev;
        },
        [[] as string[], [] as any[]]
    );
}

const encode = (request: any) => {
    const appointmentInfo = ethers.utils.defaultAbiCoder.encode(
        ...groupTuples([
            ["uint", request.customerChosenId],
            ["uint", request.jobId],
            ["uint", request.startBlock],
            ["uint", request.endBlock],
            ["uint", request.challengePeriod],
            ["uint", request.refund],
            ["bytes32", request.paymentHash]
        ])
    );
    console.log(appointmentInfo)
    const contractInfo = ethers.utils.defaultAbiCoder.encode(
        ...groupTuples([
            ["address", request.contractAddress],
            ["address", request.customerAddress],
            ["uint", request.gasLimit],
            ["bytes", request.data]
        ])
    );
    console.log(contractInfo)
    const conditionInfo = ethers.utils.defaultAbiCoder.encode(
        ...groupTuples([
            ["bytes", ethers.utils.toUtf8Bytes(request.eventABI)],
            ["bytes", request.eventArgs],
            ["bytes", request.preCondition],
            ["bytes", request.postCondition],
            ["uint", request.mode]
        ])
    );
    console.log(conditionInfo)

    return ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
            ...groupTuples([["bytes", appointmentInfo], ["bytes", contractInfo], ["bytes", conditionInfo]])
        )
    );
};

run(argv.startId);
