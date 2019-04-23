import "mocha";
import { assert } from "chai";
import * as path from "path";
import * as fse from "fs-extra";
import net from "net";

import waitPort from "wait-port";
import kill from "tree-kill";

import request from "request-promise";

import { ethers, Contract } from "ethers";

import { exec, ChildProcess } from "child_process";
import { BigNumber } from "ethers/utils";

function timeout(ms: number): Promise<any> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const pisaRoot = path.normalize(`${__dirname}/../../..`);
const demoDir = `${pisaRoot}/build/raiden_demo`;

const blockTime = 500; //block time in ms
const reveal_timeout = 10;

const initialDeposit = "20000000000000000"; // balance when channel is opened
const paymentAmount = "1000000000000000"; // amount sent from Bob

//Addresses (without "0x", with checksum)
const aliceAddr = "ccca21b97b27DefC210f01A7e64119A784424D26";
const aliceAddrLow = aliceAddr.toLowerCase();
const bobAddr = "dddEC4D561eE68F37855fa3245Cb878b10Eb1fA0";
const bobAddrLow = bobAddr.toLowerCase();
const dbFileName = ".raiden/node_ccca21b9/netid_3/network_ca70bfde/v16_log.db";

let provider: ethers.providers.Provider;

let testTokenAddr: string;
let tokenContract: Contract;
let subprocesses = [];
let parity: ChildProcess = null;
let alice: ChildProcess, bob: ChildProcess, pisa: ChildProcess, daemon: ChildProcess, autominer: ChildProcess;
let aliceTokenBalance_start: BigNumber, bobTokenBalance_start: BigNumber;

const ERC20abi = [
    {
        constant: true,
        inputs: [
            {
                name: "_owner",
                type: "address"
            }
        ],
        name: "balanceOf",
        outputs: [
            {
                name: "balance",
                type: "uint256"
            }
        ],
        payable: false,
        stateMutability: "view",
        type: "function"
    }
];

const isPortFree = (port: number) =>
    new Promise<boolean>((resolve, reject) => {
        const tester = net
            .createServer()
            .once("error", (err: any) => (err.code == "EADDRINUSE" ? resolve(false) : reject(err)))
            .once("listening", () => tester.once("close", () => resolve(true)).close())
            .listen(port);
    });

describe("Raiden end-to-end tests for scenario 2 (with Pisa)", function() {
    this.timeout(200000 + blockTime * (40 + 2 * reveal_timeout));
    //: {alice: ChildProcess, bob:ChildProcess}
    const restartAliceAndBob = async () => {
        // stop alice, stop bob
        subprocesses.splice(subprocesses.indexOf(alice), 1);
        subprocesses.splice(subprocesses.indexOf(bob), 1);

        console.log("Stopping alice and bob");
        await new Promise(resolve => kill(alice.pid, "SIGKILL", resolve));
        await new Promise(resolve => kill(bob.pid, "SIGKILL", resolve));

        // start alice and bob
        alice = await startRaidenNode("alice", aliceAddr, aliceAddrLow, 6662);
        subprocesses.push(alice);
        bob = await startRaidenNode("bob", bobAddr, bobAddrLow, 6663);
        subprocesses.push(bob);

        await waitPort({ host: "0.0.0.0", port: 6662 });
        await waitPort({ host: "0.0.0.0", port: 6663 });
    };

    const startRaidenNode = async (name: string, address: string, addressLow: string, port: number) => {
        // Start raiden
        console.log(`Starting raiden for ${name}`);
        const cmd = `${demoDir}/raiden --gas-price fast --accept-disclaimer --keystore-path ${demoDir}/docker/test-accounts --datadir ${demoDir}/.raiden --network-id ropsten --eth-rpc-endpoint http://0.0.0.0:8545 --address 0x${address} --api-address http://0.0.0.0:${port} --password-file ${demoDir}/docker/test-accounts/password--${addressLow}.txt  --no-sync-check --disable-debug-logfile --tokennetwork-registry-contract-address 0xCa70BfDEa6BD82e45d4fD26Dd9f36DB9fad61796 --secret-registry-contract-address 0xaFa1F14fe33940b22D7f9F9bf0d707860C9233e2 --endpoint-registry-contract-address 0xa4f842B60C8a21c54b16E7940aA16Dda80301d13`;
        const raidenNode = exec(cmd);
        const logStream = await fse.createWriteStream(`${pisaRoot}/logs/${name}.test.log`, { flags: "a" });
        raidenNode.stdout.pipe(logStream);
        raidenNode.stderr.pipe(logStream);
        return raidenNode;
    };

    beforeEach(async () => {
        if (!fse.existsSync(`${pisaRoot}/logs`)) await fse.mkdirp(`${pisaRoot}/logs`);

        // Test if all the ports we will need are available, abort otherwise
        console.log("Testing availability of ports for the test");

        const neededPorts = [3000, 6662, 6663, 8545];
        const isFree = await Promise.all(neededPorts.map(isPortFree));
        const busyPorts = neededPorts.filter((_, i) => !isFree[i]);
        if (busyPorts.length > 0) {
            throw new Error(
                `This test suites needs the following ports available ${neededPorts.join(", ")}:
                The following ports are not free: ${busyPorts.join(", ")}`
            );
        }

        // Make sure any old raiden db is deleted and recreated empty
        // (docker creates the folder from root if not existing, which breaks things)
        await fse.removeSync(`${demoDir}/.raiden`);
        await fse.mkdirSync(`${demoDir}/.raiden`);

        // Start parity node
        console.log("Starting Parity");

        //Start parity node
        parity = exec(
            `parity --config dev --base-path ${demoDir}/docker/chainData --chain ${demoDir}/docker/test-chain.json --jsonrpc-interface 0.0.0.0 --jsonrpc-port 8545 --jsonrpc-apis=eth,net,web3,parity --network-id 3`
        );

        subprocesses.push(parity);
        const parityLogStream = await fse.createWriteStream(`${pisaRoot}/logs/parity.test.log`, { flags: "a" });
        parity.stdout.pipe(parityLogStream);
        parity.stderr.pipe(parityLogStream);

        // Wait for parity to be ready
        await waitPort({ host: "0.0.0.0", port: 8545 });

        // Start parity node
        console.log("Starting Autominer");

        //Start parity node
        autominer = exec(
            `node ${demoDir}/autominer/build/autominer.js --period ${blockTime} --jsonrpcurl http://localhost:8545`
        );

        subprocesses.push(autominer);
        const autominerLogStream = await fse.createWriteStream(`${pisaRoot}/logs/autominer.test.log`, { flags: "a" });
        autominer.stdout.pipe(autominerLogStream);
        autominer.stderr.pipe(autominerLogStream);

        // args are redundant, but if they are removed the provider unpredictably fails
        // throwing "Error: invalid response - 0"; see https://github.com/ethers-io/ethers.js/issues/362
        provider = new ethers.providers.JsonRpcProvider("http://0.0.0.0:8545", "ropsten");

        // Start raiden node for Alice
        alice = await startRaidenNode("alice", aliceAddr, aliceAddrLow, 6662);
        subprocesses.push(alice);

        // Start raiden node for Bob
        bob = await startRaidenNode("bob", bobAddr, bobAddrLow, 6663);
        subprocesses.push(bob);

        // Start Pisa
        console.log("Starting Pisa");
        pisa = exec(
            `node ${pisaRoot}/build/src/startUp.js --json-rpc-url=http://localhost:8545 --host-name=0.0.0.0 --host-port:3000 --responder-key=0xc364a5ea32a4c267263e99ddda36e05bcb0e5724601c57d6504cccb68e1fe6ae`
        );
        subprocesses.push(pisa);
        const pisaLogStream = await fse.createWriteStream(`${pisaRoot}/logs/pisa.test.log`, { flags: "a" });
        pisa.stdout.pipe(pisaLogStream);
        pisa.stderr.pipe(pisaLogStream);

        // Make sure Alice is fully loaded
        await waitPort({ host: "0.0.0.0", port: 6662 });

        console.log("Starting the daemon");
        // Start raiden-pisa-daemon for Alice
        daemon = exec(
            `npm run start -- --pisa=0.0.0.0:3000 --keyfile=${demoDir}/docker/test-accounts/UTC--2019-03-22T10-39-56.702Z--0x${aliceAddrLow} --password-file=${demoDir}/docker/test-accounts/password--${aliceAddrLow}.txt --db=${demoDir}/${dbFileName}`,
            {
                cwd: `${demoDir}/raiden-pisa-daemon`
            }
        );
        subprocesses.push(daemon);
        const daemonLogStream = await fse.createWriteStream(`${pisaRoot}/logs/daemon.test.log`, { flags: "a" });
        daemon.stdout.pipe(daemonLogStream);
        daemon.stderr.pipe(daemonLogStream);

        console.log("Waiting for everyone to be ready.");

        // We aready waited for parity and Alice.
        await waitPort({ host: "0.0.0.0", port: 6663 }); //Wait for Bob
        await waitPort({ host: "0.0.0.0", port: 3000 }); //Wait for Pisa

        console.log("Starting scenario.");

        console.log("Getting Eth balances.");
        // Get initial eth balances for Alice and Bob
        const aliceBalance = await provider.getBalance(`0x${aliceAddr}`);
        const bobBalance = await provider.getBalance(`0x${bobAddr}`);
        console.log("Eth balances:", aliceBalance, bobBalance);

        // List available tokens
        const tokens = await request({
            method: "GET",
            uri: "http://0.0.0.0:6663/api/v1/tokens",
            json: true
        });

        testTokenAddr = tokens[0];

        console.log("Test token address:", testTokenAddr.toString());
        tokenContract = new ethers.Contract(testTokenAddr, ERC20abi, provider);
        aliceTokenBalance_start = await tokenContract.balanceOf(`0x${aliceAddr}`);
        bobTokenBalance_start = await tokenContract.balanceOf(`0x${bobAddr}`);
        console.log("Initial token balances: ", aliceTokenBalance_start, bobTokenBalance_start);
    });

    afterEach(async () => {
        console.log("CLEANUP");
        // Cleanup on exit
        const killProcesses = subprocesses.map(child => new Promise(resolve => kill(child.pid, "SIGKILL", resolve)));
        try {
            await Promise.all(killProcesses);
        } catch (doh) {
            console.error(doh);
        }

        subprocesses = [];

        //TODO: find a better way to wait for cleanup completion
        // await timeout(2000);
    });

    it("completes scenario 2 correctly", async () => {
        // Open a channel from Bob to Alice
        console.log("Bob is opening the channel to Alice");
        const openChannelResult = await request({
            method: "PUT",
            uri: "http://0.0.0.0:6663/api/v1/channels",
            json: {
                partner_address: `0x${aliceAddr}`,
                token_address: testTokenAddr,
                total_deposit: initialDeposit,
                settle_timeout: 2 * reveal_timeout
            }
        });
        console.log("Channel open response:", openChannelResult);

        // Wait some time to confirm the channel
        await timeout(20 * blockTime);

        // Make a payment from Bob to Alice
        const bobPaysAlice = async (amount: string) => {
            console.log("Bob is making the payment to Alice");
            return await request({
                method: "POST",
                uri: `http://0.0.0.0:6663/api/v1/payments/${testTokenAddr}/0x${aliceAddr}`,
                json: {
                    amount
                }
            });
        };

        // Sometimes the raiden node fails to deliver a payment!
        // We need to updgrade the raiden node, as they have fixed a lot of bugs
        // But this could be a network issue, as the raiden nodes contact Matrix servers to find routes for payments
        let paymentAttempts = 0;
        let paymentResult;
        let lastError;
        while (true) {
            paymentAttempts++;
            try {
                // make the payment
                paymentResult = await bobPaysAlice(paymentAmount);
                console.log(`Payment succeeded after ${paymentAttempts} attempt${paymentAttempts === 1 ? "" : "s"}.`);
                break;
            } catch (doh) {
                if (doh && doh.statusCode === 409) {
                    lastError = doh;
                    console.log("Payment failed, trying again.");
                } else {
                    console.log(doh);
                    throw doh;
                }
            }
            // restart alice and bob and try to pay again if we have less than 5 errors
            if (paymentAttempts >= 20) {
                console.log("Payment failed after 20 tries.");
                throw lastError;
            }
            await restartAliceAndBob();
        }
        console.log("Payment result:", paymentResult);

        // Wait to give time to daemon and Pisa to pick up the appointment
        await timeout(10 * 1000);

        // Shutdown Alice
        console.log("Shutting down Alice");
        await new Promise(resolve => kill(alice.pid, "SIGKILL", resolve));

        // Bob closes the channel
        console.log("Bob is closing the channel");
        const closeChannelResult = await request({
            method: "PATCH",
            uri: `http://0.0.0.0:6663/api/v1/channels/${testTokenAddr}/0x${aliceAddr}`,
            json: {
                state: "closed"
            }
        });
        console.log("Close channel response", closeChannelResult);

        // Wait for channel settlement
        console.log("Waiting for settlement");
        await timeout(blockTime * (2 * reveal_timeout + 5));

        console.log("Channel should now be settled. Checking final token balances");

        const aliceTokenBalance_end = await tokenContract.balanceOf(`0x${aliceAddr}`);
        const bobTokenBalance_end = await tokenContract.balanceOf(`0x${bobAddr}`);
        console.log("Token balances: ", aliceTokenBalance_end, bobTokenBalance_end);

        // Test if the final balance of Alice includes the payment from Bob
        assert(aliceTokenBalance_start.add(paymentAmount).eq(aliceTokenBalance_end), "Pisa saved the day.");
    });
});
