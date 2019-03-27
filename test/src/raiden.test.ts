import "mocha";
import { assert } from "chai";
import * as path from "path";
import * as fse from "fs-extra";

import kill from 'tree-kill';

import request from "request-promise";

import { ethers } from "ethers";

import { exec } from 'child_process';

function timeout(ms: number): Promise<any> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const pisaRoot = path.normalize(`${__dirname}/../../..`);
const demoDir = `${pisaRoot}/build/raiden_demo`;


const blockTime = 1000; //block time in ms
const reveal_timeout = 50;

const initialDeposit = "20000000000000000"; // balance when channel is opened
const paymentAmount  = "10000000000000000"; // amount sent from Bob

//Addresses (without "0x", with checksum)
const aliceAddr = "ccca21b97b27DefC210f01A7e64119A784424D26";
const aliceAddrLow = aliceAddr.toLowerCase();
const bobAddr = "dddEC4D561eE68F37855fa3245Cb878b10Eb1fA0";
const bobAddrLow = bobAddr.toLowerCase();
const dbFileName = ".raiden/node_ccca21b9/netid_3/network_ca70bfde/v16_log.db";



let provider;

let testTokenAddr;
let tokenContract;
let alice;
let aliceTokenBalance_start, bobTokenBalance_start;

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

describe("Raiden end-to-end tests for scenario 2 (with Pisa)", function() {
    this.timeout(50000 + blockTime * (40 + 2*reveal_timeout));

    beforeEach(async () => {

        //make sure any old raiden db is deleted and recreated empty
        //(docker create the folder from root if not existing, which breaks things)
        await fse.removeSync(`${demoDir}/.raiden`);
        await fse.mkdirSync(`${demoDir}/.raiden`);

        //Start parity node
        const parity = exec(`docker-compose -f ${demoDir}/docker/parity-loaded.docker-compose.yml up`);
        const parityLogStream = await fse.createWriteStream('./parity.test.log', {flags: 'a'});
        parity.stdout.pipe(parityLogStream);
        parity.stderr.pipe(parityLogStream);

        await timeout(3000);

        // args are redundant, but if they are removed the provider unpredictably fails
        // throwing "Error: invalid response - 0"; see https://github.com/ethers-io/ethers.js/issues/362
        provider = new ethers.providers.JsonRpcProvider('http://localhost:8545', "ropsten");

        //Start raiden node for Alice
        console.log("Starting Alice");
        const aliceCmd = `raiden --gas-price fast --accept-disclaimer --keystore-path ${demoDir}/docker/test-accounts --datadir ${demoDir}/.raiden --network-id ropsten --eth-rpc-endpoint http://localhost:8545 --address 0x${aliceAddr} --api-address http://0.0.0.0:6662 --password-file ${demoDir}/docker/test-accounts/password--${aliceAddrLow}.txt  --no-sync-check --disable-debug-logfile --tokennetwork-registry-contract-address 0xCa70BfDEa6BD82e45d4fD26Dd9f36DB9fad61796 --secret-registry-contract-address 0xaFa1F14fe33940b22D7f9F9bf0d707860C9233e2 --endpoint-registry-contract-address 0xa4f842B60C8a21c54b16E7940aA16Dda80301d13`;
        alice = exec(aliceCmd);
        const aliceLogStream = await fse.createWriteStream('./alice.test.log', {flags: 'a'});
        alice.stdout.pipe(aliceLogStream);
        alice.stderr.pipe(aliceLogStream);


        //Start raiden node for Bob
        console.log("Starting Bob");
        const bobCmd = `raiden --gas-price fast --accept-disclaimer --keystore-path ${demoDir}/docker/test-accounts --datadir ${demoDir}/.raiden --network-id ropsten --eth-rpc-endpoint http://localhost:8545 --address 0x${bobAddr} --api-address http://0.0.0.0:6663 --password-file ${demoDir}/docker/test-accounts/password--${bobAddrLow}.txt  --no-sync-check --disable-debug-logfile --tokennetwork-registry-contract-address 0xCa70BfDEa6BD82e45d4fD26Dd9f36DB9fad61796 --secret-registry-contract-address 0xaFa1F14fe33940b22D7f9F9bf0d707860C9233e2 --endpoint-registry-contract-address 0xa4f842B60C8a21c54b16E7940aA16Dda80301d13`;
        const bob = exec(bobCmd);
        const bobLogStream = await fse.createWriteStream('./bob.test.log', {flags: 'a'});
        bob.stdout.pipe(bobLogStream);
        bob.stderr.pipe(bobLogStream);

        //Start Pisa
        console.log("Starting Pisa");
        const pisa = exec(`docker run -p 3000:3000 --network docker_raidendemo --network-alias pisa -v ${pisaRoot}/configs/parity.json:/usr/pisa/build/config.json pisaresearch/pisa:latest`, (err) => {
            throw err;
        });
        const pisaLogStream = await fse.createWriteStream('./pisa.test.log', {flags: 'a'});
        pisa.stdout.pipe(pisaLogStream);
        pisa.stderr.pipe(pisaLogStream);

        //Wait so that Alice creates the db
        await timeout(10000);

        console.log("Starting the daemon");
        //Start raiden-pisa-daemon for Alice
        const daemon = exec(`docker run -v ${demoDir}/docker/test-accounts/password--${aliceAddrLow}.txt:/home/password.txt -v ${demoDir}/docker/test-accounts/UTC--2019-03-22T10-39-56.702Z--0x${aliceAddrLow}:/.ethereum/keystore/UTC--2019-03-22T10-39-56.702Z--0x${aliceAddrLow} -v ${demoDir}/${dbFileName}:/home/db --network docker_raidendemo --entrypoint "npm" pisaresearch/raiden-pisa-daemon:latest run start -- --pisa=pisa:3000 --keyfile=/.ethereum/keystore/UTC--2019-03-22T10-39-56.702Z--0x${aliceAddrLow}  --password-file=/home/password.txt --db=/home/db`, (err) => {
            throw err;
        });
        const daemonLogStream = await fse.createWriteStream('./daemon.test.log', {flags: 'a'});
        daemon.stdout.pipe(daemonLogStream);
        daemon.stderr.pipe(daemonLogStream);

        //TODO: check that everything started correctly

        console.log("Waiting for everyone to be ready.");

        await timeout(3000);

        console.log("Starting scenario.");

        //TODO: get initial token balances for Alice and Bob#
        const aliceBalance = await provider.getBalance(`0x${aliceAddr}`);
        const bobBalance = await provider.getBalance(`0x${bobAddr}`);
        console.log("Eth balances:", aliceBalance, bobBalance);


        //List available tokens
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


        //Cleanup on exit
        process.on('exit', function() {
            const children = [daemon, pisa, bob, alice, parity]
            console.log('killing', children.length, 'child processes');
            children.forEach(function(child) {
              child.kill();
            });

            //TODO: delete raiden db?
          });
        
        console.log("Done setting up");
    });

    it("completes scenario 2 correctly", async () => {

        // Open a channel from Bob to Alice
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

        //TODO: should we wait here?

        await timeout(10*blockTime);


        // Make a payment from Bob to Alice
        const paymentResult = await request({
            method: "POST",
            uri: `http://0.0.0.0:6663/api/v1/payments/${testTokenAddr}/0x${aliceAddr}`,
            json: {
                amount: paymentAmount
            }
        });
        console.log("Payment result:", paymentResult);

        // Wait to give time to daemon and Pisa to pick up the appointment 
        await timeout(20 * blockTime);

        // Shutdown Alice
        await new Promise(resolve => kill(alice.pid, 'SIGKILL', resolve));

        // Bob closes the channel
        // Make a payment from Bob to Alice
        const closeChannelResult = await request({
            method: "PATCH",
            uri: `http://0.0.0.0:6663/api/v1/channels/${testTokenAddr}/0x${aliceAddr}`,
            json: {
                state: "closed"
            }
        });
        console.log("Close channel response", closeChannelResult);

        //Wait for channel settlement
        console.log("Waiting for settlement");
        await timeout(blockTime * (2*reveal_timeout + 5));
        
        console.log("Channel should now be settled. Checking final token balances");

        const aliceTokenBalance_end = await tokenContract.balanceOf(`0x${aliceAddr}`);
        const bobTokenBalance_end = await tokenContract.balanceOf(`0x${bobAddr}`);
        console.log("Token balances: ", aliceTokenBalance_end, bobTokenBalance_end);


        //TODO: fix the comparison
        assert(aliceTokenBalance_start.add(paymentAmount).eq(aliceTokenBalance_end), "Pisa saved the day.");
    });

});
