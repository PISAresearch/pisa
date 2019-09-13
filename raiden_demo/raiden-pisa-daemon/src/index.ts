import * as fs from "fs";

import { SqliteListener } from "./sqlite-listener";
import { BalanceProofSigGroup, IRawBalanceProof } from "./balanceProof";
import { getWallet } from "./wallet";
import { RaidenTools } from "./tools";
import { ethers } from "ethers";
import { keccak256 } from "ethers/utils";
import PisaClient from "../../../client";


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
    .demandOption(["jsonRpcUrl"])
    .describe("jsonRpcUrl", "The connected ethereum client.")
    .demandOption(["pisaContractAddress"])
    .describe("pisaContractAddress", "The address of the on-chain PISA contract.")
    .help().argv;

const run = async (startingRowId: number) => {
    try {
        const password = fs
            .readFileSync(argv.passwordFile)
            .toString()
            .trim();
        const wallet = await getWallet(argv.keyfile, password);
        const pisaClient = new PisaClient("http://" + argv.pisa, argv.pisaContractAddress);
        
        const provider = new ethers.providers.JsonRpcProvider(argv.jsonRpcUrl);

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

            const blockNumber = await provider.getBlockNumber();            

            const signer = (digest: string) => wallet.signMessage(ethers.utils.arrayify(digest))
            const request = await pisaClient.generateRequest(
                signer,
                wallet.address,
                "0x0000000000000000000000000000000000000000000000000000000000000001",
                0,
                blockNumber,
                10000,
                sigGroup.token_network_identifier,
                encodedForUpdate,
                200000,
                200,
                sigGroup.token_network_identifier,
                RaidenTools.eventABI(),
                RaidenTools.eventArgs(sigGroup.channel_identifier, bp.sender),
            );
            console.log(request);
            await pisaClient.executeRequest(request);
        };

        const listener = new SqliteListener(10000, argv.db, startingRowId, callback);
        listener.start();

        console.log("listening for updates...");
    } catch (err) {
        console.error(err);
    }
};

const encode = (request: any, pisaContractAddress: string) => {
    return ethers.utils.defaultAbiCoder.encode(
        [
            "tuple(address,address,uint,uint,uint,bytes32,uint,bytes,uint,uint,uint,address,string,bytes,bytes,bytes,bytes32)",
            "address"
        ],
        [
            [
                request.contractAddress,
                request.customerAddress,
                request.startBlock,
                request.endBlock,
                request.challengePeriod,
                request.id,
                request.nonce,
                request.data,
                request.refund,
                request.gasLimit,
                request.mode,
                request.eventAddress,
                request.eventABI,
                request.eventArgs,
                request.preCondition,
                request.postCondition,
                request.paymentHash
            ],
            pisaContractAddress
        ]
    );
};

run(argv.startId);
