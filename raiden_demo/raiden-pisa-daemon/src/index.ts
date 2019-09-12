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
        const pisaClient = new PisaClient(argv.pisa);
        const pisaContractAddress = argv.pisaContractAddress;
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

            const request = {
                challengePeriod: 200,
                contractAddress: sigGroup.token_network_identifier,
                customerAddress: wallet.address,
                data: encodedForUpdate,
                endBlock: 10000,
                eventAddress: sigGroup.token_network_identifier,
                eventABI: RaidenTools.eventABI(),
                eventArgs: RaidenTools.eventArgs(sigGroup.channel_identifier, bp.sender),
                gasLimit: 200000,
                id: "0x0000000000000000000000000000000000000000000000000000000000000001",
                nonce: 0,
                mode: 1,
                preCondition: "0x",
                postCondition: "0x",
                refund: "0",
                startBlock: blockNumber,
                paymentHash: ethers.utils.keccak256(ethers.utils.toUtf8Bytes("on-the-house")),
                customerSig: "0x"
            };
            const encoded = encode(request, pisaContractAddress);
            const hashedWithAddress = keccak256(encoded);
            const sig = await wallet.signMessage(ethers.utils.arrayify(hashedWithAddress));
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
                request.customerChosenId,
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
