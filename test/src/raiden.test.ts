import "mocha";
import { assert } from "chai";
import * as path from "path";
import * as fse from "fs-extra";
import net from 'net';

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


const blockTime = 1000; //block time in ms
const reveal_timeout = 5;

const initialDeposit = "20000000000000000"; // balance when channel is opened
const paymentAmount  = "10000000000000000"; // amount sent from Bob

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
let alice: ChildProcess, bob: ChildProcess, pisa: ChildProcess, daemon: ChildProcess;
let aliceTokenBalance_start: BigNumber, bobTokenBalance_start: BigNumber;

const ERC20abi = [
    {
        "constant": true,
        "inputs": [
            {
                "name": "_owner",
                "type": "address"
            }
        ],
        "name": "balanceOf",
        "outputs": [
            {
                "name": "balance",
                "type": "uint256"
            }
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function"
    }
  ];

const isPortFree = (port) => new Promise<boolean>((resolve, reject) => {
    const tester = net.createServer()
        .once('error', (err: any) => (err.code == 'EADDRINUSE' ? resolve(false) : reject(err)))
        .once('listening', () => tester.once('close', () => resolve(true)).close())
        .listen(port)
});

describe("Raiden end-to-end tests for scenario 2 (with Pisa)", function() {
    this.timeout(50000 + blockTime * (40 + 2*reveal_timeout));

    beforeEach(async () => {

        // Test if all the ports we will need are available, abort otherwise
        console.log("Testing availability of ports for the test");

        const neededPorts = [3000, 6662, 6663, 8545];
        const isFree = await Promise.all(neededPorts.map(isPortFree));
        const busyPorts = neededPorts.filter((_, i) => !isFree[i]);
        if (busyPorts.length > 0) {
            throw new Error(
                `This test suites needs the following ports available ${neededPorts.join(', ')}:
                The following ports are not free: ${busyPorts.join(', ')}`
            );
        }

        // Make sure any old raiden db is deleted and recreated empty
        // (docker creates the folder from root if not existing, which breaks things)
        await fse.removeSync(`${demoDir}/.raiden`);
        await fse.mkdirSync(`${demoDir}/.raiden`);

        // Start parity node
        console.log("Starting Parity");

        //Start parity node
        parity = exec(`docker-compose -f ${demoDir}/docker/parity-loaded.docker-compose.yml up`);
        if (!process.env.CIRCLECI) {
            const parityLogStream = await fse.createWriteStream(`${pisaRoot}/logs/parity.test.log`, {flags: 'a'});
            parity.stdout.pipe(parityLogStream);
            parity.stderr.pipe(parityLogStream);
        }

        // Wait for parity to be ready
        await waitPort({host: "0.0.0.0", port: 8545});

        // args are redundant, but if they are removed the provider unpredictably fails
        // throwing "Error: invalid response - 0"; see https://github.com/ethers-io/ethers.js/issues/362
        provider = new ethers.providers.JsonRpcProvider('http://0.0.0.0:8545', "ropsten");

        // Start raiden node for Alice
        console.log("Starting Alice");
        const aliceCmd = `${demoDir}/raiden --gas-price fast --accept-disclaimer --keystore-path ${demoDir}/docker/test-accounts --datadir ${demoDir}/.raiden --network-id ropsten --eth-rpc-endpoint http://0.0.0.0:8545 --address 0x${aliceAddr} --api-address http://0.0.0.0:6662 --password-file ${demoDir}/docker/test-accounts/password--${aliceAddrLow}.txt  --no-sync-check --disable-debug-logfile --tokennetwork-registry-contract-address 0xCa70BfDEa6BD82e45d4fD26Dd9f36DB9fad61796 --secret-registry-contract-address 0xaFa1F14fe33940b22D7f9F9bf0d707860C9233e2 --endpoint-registry-contract-address 0xa4f842B60C8a21c54b16E7940aA16Dda80301d13`;
        alice = exec(aliceCmd);
        subprocesses.push(alice);
        const aliceLogStream = await fse.createWriteStream(`${pisaRoot}/logs/alice.test.log`, {flags: 'a'});
        alice.stdout.pipe(aliceLogStream);
        alice.stderr.pipe(aliceLogStream);


        // Start raiden node for Bob
        console.log("Starting Bob");
        const bobCmd = `${demoDir}/raiden --gas-price fast --accept-disclaimer --keystore-path ${demoDir}/docker/test-accounts --datadir ${demoDir}/.raiden --network-id ropsten --eth-rpc-endpoint http://0.0.0.0:8545 --address 0x${bobAddr} --api-address http://0.0.0.0:6663 --password-file ${demoDir}/docker/test-accounts/password--${bobAddrLow}.txt  --no-sync-check --disable-debug-logfile --tokennetwork-registry-contract-address 0xCa70BfDEa6BD82e45d4fD26Dd9f36DB9fad61796 --secret-registry-contract-address 0xaFa1F14fe33940b22D7f9F9bf0d707860C9233e2 --endpoint-registry-contract-address 0xa4f842B60C8a21c54b16E7940aA16Dda80301d13`;
        bob = exec(bobCmd);
        subprocesses.push(bob);
        if (!process.env.CIRCLECI) {
            const bobLogStream = await fse.createWriteStream(`${pisaRoot}/logs/bob.test.log`, {flags: 'a'});
            bob.stdout.pipe(bobLogStream);
            bob.stderr.pipe(bobLogStream);
        }

        await timeout(10000);

        // Start Pisa
        console.log("Starting Pisa");
        pisa = exec(`node ${pisaRoot}/build/src/startUp.js --json-rpc-url=http://localhost:8545 --host-name=0.0.0.0 --host-port:3000 --watcher-key=0xc364a5ea32a4c267263e99ddda36e05bcb0e5724601c57d6504cccb68e1fe6ae`);
        subprocesses.push(pisa);
        if (!process.env.CIRCLECI) {
            const pisaLogStream = await fse.createWriteStream(`${pisaRoot}/logs/pisa.test.log`, {flags: 'a'});
            pisa.stdout.pipe(pisaLogStream);
            pisa.stderr.pipe(pisaLogStream);
        }

        // Make sure Alice is fully loaded
        await waitPort({host: "0.0.0.0", port: 6662});

        console.log("Starting the daemon");
        // Start raiden-pisa-daemon for Alice
        daemon = exec(`docker run -v ${demoDir}/docker/test-accounts/password--${aliceAddrLow}.txt:/home/password.txt -v ${demoDir}/docker/test-accounts/UTC--2019-03-22T10-39-56.702Z--0x${aliceAddrLow}:/.ethereum/keystore/UTC--2019-03-22T10-39-56.702Z--0x${aliceAddrLow} -v ${demoDir}/${dbFileName}:/home/db --network host --entrypoint "npm" pisaresearch/raiden-pisa-daemon:latest run start -- --pisa=0.0.0.0:3000 --keyfile=/.ethereum/keystore/UTC--2019-03-22T10-39-56.702Z--0x${aliceAddrLow}  --password-file=/home/password.txt --db=/home/db`);
        subprocesses.push(daemon);
        if (!process.env.CIRCLECI) {
            const daemonLogStream = await fse.createWriteStream(`${pisaRoot}/logs/daemon.test.log`, {flags: 'a'});
            daemon.stdout.pipe(daemonLogStream);
            daemon.stderr.pipe(daemonLogStream);
        }

        console.log("Waiting for everyone to be ready.");

        // We aready waited for parity and Alice.

        await waitPort({host: "0.0.0.0", port: 6663}); //Wait for Bob
        await waitPort({host: "0.0.0.0", port: 3000}); //Wait for Pisa

        // Wait some time for the daemon
        await timeout(1000);

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
        subprocesses.forEach((child) => {
            try {
                kill(child.pid);
            } catch(err) {
                // Ignore error on cleanup, but log it anyway
                console.log(err);
            }
        });
        subprocesses = [];

        if (!!parity) {
            // docker-compose down for parity; this takes some time.
            const dockerComposeDown = exec(`docker-compose -f ${demoDir}/docker/parity-loaded.docker-compose.yml down --rmi all`);
            dockerComposeDown.stdout.on('data', (data) => console.log('stdout: ' + data.toString()));
            dockerComposeDown.stderr.on('data', (data) => console.log('stdout: ' + data.toString()));

            // Wait for the process to completely shutdown
            await new Promise((resolve) => dockerComposeDown.once("exit", resolve));
        }
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
                settle_timeout: 2*reveal_timeout
            }
        });
        console.log("Channel open response:", openChannelResult);

        // Wait some time to confirm the channel
        await timeout(20 * blockTime);


        // Make a payment from Bob to Alice
        console.log("Bob is making the payment to Alice");
        const paymentResult = await request({
            method: "POST",
            uri: `http://0.0.0.0:6663/api/v1/payments/${testTokenAddr}/0x${aliceAddr}`,
            json: {
                amount: paymentAmount
            }
        });
        console.log("Payment result:", paymentResult);

        // Wait to give time to daemon and Pisa to pick up the appointment 
        await timeout(10 * 1000);

        // Shutdown Alice
        console.log("Shutting down Alice")
        await new Promise(resolve => kill(alice.pid, 'SIGKILL', resolve));

        // Bob closes the channel
        console.log("Bob is closing the channel")
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
        await timeout(blockTime * (2*reveal_timeout + 5));
        
        console.log("Channel should now be settled. Checking final token balances");

        const aliceTokenBalance_end = await tokenContract.balanceOf(`0x${aliceAddr}`);
        const bobTokenBalance_end = await tokenContract.balanceOf(`0x${bobAddr}`);
        console.log("Token balances: ", aliceTokenBalance_end, bobTokenBalance_end);

        // Test if the final balance of Alice includes the payment from Bob
        assert(aliceTokenBalance_start.add(paymentAmount).eq(aliceTokenBalance_end), "Pisa saved the day.");
    });
});
