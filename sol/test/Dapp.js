const Dapp = artifacts.require("Dapp");
const assert = require("chai").assert;
var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
var dappInstance;

web3.providers.HttpProvider.prototype.sendAsync = web3.providers.HttpProvider.prototype.send;

advanceTimeAndBlock = async (time) => {
    await advanceTime(time);
    await advanceBlock();

    return Promise.resolve(web3.eth.getBlock('latest'));
}

advanceTime = (time) => {
    return new Promise((resolve, reject) => {
        web3.currentProvider.sendAsync({
            jsonrpc: "2.0",
            method: "evm_increaseTime",
            params: [time],
            id: new Date().getTime()
        }, (err, result) => {
            if (err) {
                return reject(err);
            }
            return resolve(result);
        });
    });
}

revertSnapshot = (_result) => {

    console.log("ID we are using: " + _result);

    return new Promise((resolve, reject) => {
        web3.currentProvider.sendAsync({
            jsonrpc: "2.0",
            method: "evm_revert",
            params: [_result],
            id: new Date().getTime()
        }, (err, result) => {
            if (err) {
                return reject(err);
            }
            return resolve(result);
        });
    });
}


advanceBlock = () => {
    return new Promise((resolve, reject) => {
        web3.currentProvider.sendAsync({
            jsonrpc: "2.0",
            method: "evm_mine",
            id: new Date().getTime()
        }, (err, result) => {
            if (err) {
                return reject(err);
            }
            const newBlockHash = web3.eth.getBlock('latest').hash;

            return resolve(newBlockHash);
        });
    });
}

snapshotBlock = () => {
    return new Promise((resolve, reject) => {
        web3.currentProvider.sendAsync({
            jsonrpc: "2.0",
            method: "evm_snapshot",
            id: new Date().getTime()
        }, (err, result) => {
            if (err) {
                return reject(err);
            }
            // const newBlockHash = web3.eth.getBlock('latest').hash;
            return resolve(result);
        });
    });
}

// Stored for long-term use between tests.
let appointment; // Appointment array
let encodedAppointment; // Appointment encoding
let channelId; // Channel ID

function createToCall(_mode, _v) {

    if (_mode == 1) {

        return web3.eth.abi.encodeFunctionCall({
            "constant": false,
            "inputs": [],
            "name": "rescue",
            "outputs": [],
            "payable": false,
            "stateMutability": "nonpayable",
            "type": "function"

        }, []);
    }

    if (_mode == 2) {

        return web3.eth.abi.encodeFunctionCall({
            "constant": false,
            "inputs": [],
            "name": "superRescue",
            "outputs": [],
            "payable": false,
            "stateMutability": "nonpayable",
            "type": "function"

        }, []);
    }
}

module.exports = {
    advanceTime,
    advanceBlock,
    advanceTimeAndBlock
}

function getCurrentTime() {
    return new Promise(function (resolve) {
        web3.eth.getBlock("latest").then(function (block) {
            resolve(block.timestamp)
        });
    })
}

function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function createAppointment(_sc, _blockNo, _cus, _v, _jobid, _mode, _precondition, _postcondition, _minChallengePeriod, _eventABI) {

    const endBlock = _blockNo + 500;
    const minChallengePeriod = _minChallengePeriod;
    const mode = _mode; // We know what dispute handler to use!
    const toCall = createToCall(mode, _v);
    const refund = "100"; // 100 wei
    const gas = "1000000"; // PISA will allocate up to 1m gas for this jobs
    const h = web3.utils.keccak256(web3.utils.fromAscii("on-the-house"));

    appointment = {
        startBlock: _blockNo + 4,
        endBlock,
        customerAddress: _cus,
        id: channelId,
        jobid: _jobid,
        data: toCall,
        refund: refund,
        gasLimit: gas,
        mode: mode,
        eventABI: _eventABI,
        eventArgs: web3.eth.abi.encodeParameters(['uint8[]'], [
            []
        ]),
        precondition: _precondition,
        postcondition: _postcondition,
        paymentHash: h,
        r: web3.utils.fromAscii("on-the-house"),
        v: _v,
        challengePeriod: minChallengePeriod,
        contractAddress: _sc
    };

    bytesEventABI = web3.utils.fromAscii(_eventABI);

    const encodeAppointmentInfo = web3.eth.abi.encodeParameters(['uint', 'uint', 'uint', 'uint', 'uint', 'uint', 'bytes32'], [appointment['id'], appointment['jobid'], appointment['startBlock'], appointment['endBlock'], appointment['challengePeriod'], appointment['refund'], appointment['paymentHash']]);
    const encodeContractInfo = web3.eth.abi.encodeParameters(['address', 'address', 'uint', 'bytes'], [appointment['contractAddress'], appointment['customerAddress'], appointment['gasLimit'], appointment['data']]);
    const encodeConditions = web3.eth.abi.encodeParameters(['bytes', 'bytes', 'bytes', 'bytes', 'uint'], [bytesEventABI, appointment['eventArgs'], appointment['precondition'], appointment['postcondition'], appointment['mode']]);

    encodedAppointment = web3.eth.abi.encodeParameters(['bytes', 'bytes', 'bytes'], [encodeAppointmentInfo, encodeContractInfo, encodeConditions]);
}

contract('Dapp', (accounts) => {

    //Method that will be used to book appointment with PISA server
    function sendData(data) {
        return new Promise(function (resolve, reject) {
            const xhr = new XMLHttpRequest();
            const url = "http://localhost:3000/appointment";
            xhr.open("POST", url, true);
            xhr.setRequestHeader("Content-Type", "application/json");
            xhr.onreadystatechange = function () {
                if (this.readyState == 4 && this.status == 200) {
                    const json = JSON.parse(xhr.responseText);

                    resolve(json);

                } else if (xhr.status == 400) {
                    console.log(xhr.responseText);
                    reject("oops");
                }
            };

            xhr.send(data);
        });
    }

    beforeEach(async () => {
        const accounts = await web3.eth.getAccounts();

        //set accounts
        account0 = accounts[0];
        account1 = accounts[1];
        account2 = accounts[2];
        account3 = accounts[3];

        //create a  new instace of the Dapp.sol contract before every test
        return Dapp.new()
            .then(function (instance) {
                dappInstance = instance;
            });
    });

    it('PISA is hired and must respond to Distress event', async () => {

        let blockNo = await web3.eth.getBlockNumber();
        channelId = 200;

        await advanceBlock();
        let timestamp = await getCurrentTime();

        createAppointment(dappInstance.address, blockNo, account1, 20, timestamp, 1, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 50), 100, "event Distress(string indexed message)");

        let hash = web3.utils.keccak256(encodedAppointment);
        let cussig = await web3.eth.sign(hash, account1);

        var data = JSON.stringify({
            "challengePeriod": appointment['challengePeriod'],
            "contractAddress": appointment['contractAddress'],
            "customerAddress": appointment['customerAddress'],
            "customerSig": cussig,
            "data": appointment['data'],
            "endBlock": appointment['endBlock'],
            "eventABI": appointment['eventABI'],
            "eventArgs": appointment['eventArgs'],
            "gasLimit": appointment['gasLimit'],
            "id": appointment['id'],
            "jobId": appointment['jobid'],
            "mode": appointment['mode'],
            "paymentHash": appointment['paymentHash'],
            "preCondition": appointment['precondition'],
            "postCondition": appointment['postcondition'],
            "refund": appointment['refund'],
            "startBlock": appointment['startBlock']
        });

        //Book appointment with PISA                           
        let response = await sendData(data);

        //Trigger event that PISA was hired to watch
        await dappInstance.distressCall();

        await timeout(1000);

        //Making sure there are enough confirmations so that event is confirmed => PISA has to respond
        for (let i = 0; i < 50; i++) {
            await advanceBlock();
            await timeout(500);
        }

        //Timeout as pisa is a live service that is tested
        await timeout(1000);

        //Verify that PISA has responded, by checking that the counter in the method that PISA was supossed to call in case of event has been incremented
        assert.equal(await dappInstance.counter.call(), 1, "Counter should be 1... that way we know PISA did its job");
        assert.equal(await dappInstance.inTrouble(), false, "should be in TROUBLE");

    });

    it("PISA is hired and must respond to SuperDistress event", async () => {

        for (let i = 0; i < 20; i++) {
            await advanceBlock();
            await timeout(100);
        }

        const blockNo = await web3.eth.getBlockNumber();
        await advanceBlock();
        const timestamp = await getCurrentTime();

        createAppointment(dappInstance.address, blockNo, account0, 20, timestamp, 2, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 50), 100, "event SuperDistress(string indexed message)");

        const hash = web3.utils.keccak256(encodedAppointment);
        const customerSig = await web3.eth.sign(hash, account0);

        const data = JSON.stringify({
            "challengePeriod": appointment['challengePeriod'],
            "contractAddress": appointment['contractAddress'],
            "customerAddress": appointment['customerAddress'],
            "customerSig": customerSig,
            "data": appointment['data'],
            "endBlock": appointment['endBlock'],
            "eventABI": appointment['eventABI'],
            "eventArgs": appointment['eventArgs'],
            "gasLimit": appointment['gasLimit'],
            "id": appointment['id'],
            "jobId": appointment['jobid'],
            "mode": appointment['mode'],
            "paymentHash": appointment['paymentHash'],
            "preCondition": appointment['precondition'],
            "postCondition": appointment['postcondition'],
            "refund": appointment['refund'],
            "startBlock": appointment['startBlock']
        });

        //Book appointment with PISA                           
        await sendData(data);

        //Trigger event that PISA was hired to watch
        await dappInstance.superDistressCall();

        await timeout(1000);

        //Making sure there are enough confirmations so that event is confirmed => PISA has to respond
        for (let i = 0; i < 50; i++) {
            await advanceBlock();
            await timeout(500);
        }

        await timeout(1000);

        //Verify that PISA has responded, by checking that the counter in the method that PISA was supossed to call in case of event has been incremented
        assert.equal(await dappInstance.superCounter.call(), 1, "Counter should be 1... that way we know PISA did its job");
    })


    // it("PISA handles two concurrent events from different appointments", async() => {
    //     for (let i = 0; i < 20; i++) {
    //         await advanceBlock();
    //         await timeout(100);
    //     }  
    //     let blockNo = await web3.eth.getBlockNumber();
    //     await advanceBlock();
    //     let timestamp = await getCurrentTime();
    //     let dappInstance = await Dapp.deployed();

    //     createAppointment(dappInstance.address, blockNo, account3, 20, timestamp, 2, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 50), 100, "event distress(string indexed message)");

    //     let hash = web3.utils.keccak256(encodedAppointment);
    //     let cussig =  await web3.eth.sign(hash,account3);

    //     var data = JSON.stringify({"challengePeriod": appointment['challengePeriod'],
    //                                "contractAddress": appointment['contractAddress'],
    //                                "customerAddress": appointment['customerAddress'],
    //                                "customerSig": cussig,
    //                                "data": appointment['data'],
    //                                "endBlock": appointment['endBlock'],
    //                                "eventABI": appointment['eventABI'],
    //                                "eventArgs": appointment['eventArgs'],
    //                                "gasLimit": appointment['gasLimit'],
    //                                "id": appointment['id'],
    //                                "jobId": appointment['jobid'],
    //                                "mode": appointment['mode'],
    //                                "paymentHash": appointment['paymentHash'],
    //                                "preCondition": appointment['precondition'],
    //                                "postCondition": appointment['postcondition'],
    //                                "refund": appointment['refund'],
    //                                "startBlock": appointment['startBlock']});

    //     let response = await sendData(data);

    //    createAppointment(dappInstance.address, blockNo, account2, 20, timestamp, 1, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 50), 100, "event SuperDistress(string indexed message)");

    //     let hash1 = web3.utils.keccak256(encodedAppointment);
    //     let cussig1 =  await web3.eth.sign(hash1,account2);

    //     var data1 = JSON.stringify({"challengePeriod": appointment['challengePeriod'],
    //                                "contractAddress": appointment['contractAddress'],
    //                                "customerAddress": appointment['customerAddress'],
    //                                "customerSig": cussig1,
    //                                "data": appointment['data'],
    //                                "endBlock": appointment['endBlock'],
    //                                "eventABI": appointment['eventABI'],
    //                                "eventArgs": appointment['eventArgs'],
    //                                "gasLimit": appointment['gasLimit'],
    //                                "id": appointment['id'],
    //                                "jobId": appointment['jobid'],
    //                                "mode": appointment['mode'],
    //                                "paymentHash": appointment['paymentHash'],
    //                                "preCondition": appointment['precondition'],
    //                                "postCondition": appointment['postcondition'],
    //                                "refund": appointment['refund'],
    //                                "startBlock": appointment['startBlock']})

    //      let response1 = await sendData(data1);

    //       await dappInstance.distressCall(); 
    //       await dappInstance.superDistressCall(); 

    //      await timeout(1000);

    //       //making sure there are enough confirmations
    //      for(var i=0; i<20; i++) {
    //          await advanceBlock();
    //          await timeout(100);
    //       }

    //      await timeout(1000);

    //      assert.equal(await dappInstance.counter.call(), 1, "Counter should be 1... that way we know PISA did its job");
    //      assert.equal(await dappInstance.superCounter.call(), 1, "superCounter should be 1... that way we know PISA did its job");
    // })




    // it("PISA is hired by two customers for the same event and it should respond to both", async() => {
    //     for(var i=0; i<20; i++) {
    //         await advanceBlock();
    //         await timeout(100);
    //     }  
    //     let blockNo = await web3.eth.getBlockNumber();
    //     await advanceBlock();
    //     let timestamp = await getCurrentTime();
    //     var dappInstance = await Dapp.deployed();
    //     createAppointment(dappInstance.address, blockNo, account3, 20, timestamp, 2, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 50), 100, "event SuperDistress(string indexed message)");

    //     let hash = web3.utils.keccak256(encodedAppointment);
    //     let cussig =  await web3.eth.sign(hash,account3);

    //     var data = JSON.stringify({"challengePeriod": appointment['challengePeriod'],
    //                                "contractAddress": appointment['contractAddress'],
    //                                "customerAddress": appointment['customerAddress'],
    //                                "customerSig": cussig,
    //                                "data": appointment['data'],
    //                                "endBlock": appointment['endBlock'],
    //                                "eventABI": appointment['eventABI'],
    //                                "eventArgs": appointment['eventArgs'],
    //                                "gasLimit": appointment['gasLimit'],
    //                                "id": appointment['id'],
    //                                "jobId": appointment['jobid'],
    //                                "mode": appointment['mode'],
    //                                "paymentHash": appointment['paymentHash'],
    //                                "preCondition": appointment['precondition'],
    //                                "postCondition": appointment['postcondition'],
    //                                "refund": appointment['refund'],
    //                                "startBlock": appointment['startBlock']});

    //     let response = await sendData(data);

    //    createAppointment(dappInstance.address, blockNo, account2, 20, timestamp, 1, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 50), 100, "event SuperDistress(string indexed message)");

    //     let hash1 = web3.utils.keccak256(encodedAppointment);
    //     let cussig1 =  await web3.eth.sign(hash1,account2);

    //     var data1 = JSON.stringify({"challengePeriod": appointment['challengePeriod'],
    //                                "contractAddress": appointment['contractAddress'],
    //                                "customerAddress": appointment['customerAddress'],
    //                                "customerSig": cussig1,
    //                                "data": appointment['data'],
    //                                "endBlock": appointment['endBlock'],
    //                                "eventABI": appointment['eventABI'],
    //                                "eventArgs": appointment['eventArgs'],
    //                                "gasLimit": appointment['gasLimit'],
    //                                "id": appointment['id'],
    //                                "jobId": appointment['jobid'],
    //                                "mode": appointment['mode'],
    //                                "paymentHash": appointment['paymentHash'],
    //                                "preCondition": appointment['precondition'],
    //                                "postCondition": appointment['postcondition'],
    //                                "refund": appointment['refund'],
    //                                "startBlock": appointment['startBlock']})

    //      let response1 = await sendData(data1);

    //       await dappInstance.superDistressCall(); 

    //       await timeout(1000);

    //       //making sure there are enough confirmations
    //       for(var i=0; i<20; i++) {
    //          await advanceBlock();
    //          await timeout(100);
    //       }

    //      await timeout(1000);

    //      assert.equal(await dappInstance.superCounter.call(), 4, "Counter should be 3... that way we know PISA did its job");
    // })

    it('PISA should not respond if a reorg happens where the event is not called', async () => {
        // If a reorg happens before Pisa hired the responder and the event did not happen on the new fork,
        // PISA should not do anything.

        let blockNo = await web3.eth.getBlockNumber();
        channelId = 200;

        await advanceBlock();
        let timestamp = await getCurrentTime();

        createAppointment(dappInstance.address, blockNo, account2, 20, timestamp, 1, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 50), 100, "event Distress(string indexed message)");

        let hash = web3.utils.keccak256(encodedAppointment);
        let cussig = await web3.eth.sign(hash, account2);

        var data = JSON.stringify({
            "challengePeriod": appointment['challengePeriod'],
            "contractAddress": appointment['contractAddress'],
            "customerAddress": appointment['customerAddress'],
            "customerSig": cussig,
            "data": appointment['data'],
            "endBlock": appointment['endBlock'],
            "eventABI": appointment['eventABI'],
            "eventArgs": appointment['eventArgs'],
            "gasLimit": appointment['gasLimit'],
            "id": appointment['id'],
            "jobId": appointment['jobid'],
            "mode": appointment['mode'],
            "paymentHash": appointment['paymentHash'],
            "preCondition": appointment['precondition'],
            "postCondition": appointment['postcondition'],
            "refund": appointment['refund'],
            "startBlock": appointment['startBlock']
        });

        //Book appointment with PISA                           
        let response = await sendData(data);

        //Take a snapshot of the current block, before the event PISA was hired to watch happens
        let snapshot = await snapshotBlock();
        blockNo = await web3.eth.getBlockNumber();
        prevStateID = snapshot['result'];
        prevBlockNo = blockNo;

        //Check that  PISA has not responded
        assert.equal(await dappInstance.counter.call(), 0, "before snapshot: Counter should be 0");
        assert.equal(await dappInstance.inTrouble(), false, "before snapshot: inTrouble should be false");

        //Trigger event that PISA was hired to watch
        await dappInstance.distressCall();

        await timeout(500);

        // Mine less than 5 blocks
        for (let i = 0; i < 3; i++) {
            await advanceBlock();
            await timeout(100);
        }

        //Timeout as pisa is a live service that is tested
        await timeout(500);

        //Check that PISA did not respond prematurely
        assert.equal(await dappInstance.counter.call(), 0, "After snapshot: Counter should be 0 if Pisa did not respond prematurely");
        assert.equal(await dappInstance.inTrouble(), true, "After snapshot: Should be in TROUBLE");

        //Construct a reorg back from the block we took a snapshot at
        let result = await revertSnapshot(prevStateID);
        blockNo = await web3.eth.getBlockNumber();
        assert.equal(prevBlockNo, blockNo, "checking revert worked");


        //Making sure there are enough confirmations and this fork is longer than the initial one
        for (let i = 0; i < 75; i++) {
            await advanceBlock();
            await timeout(100);
        }

        //Check that PISA has not responded, as in the reorg the event PISA was hired to watch never happened
        assert.equal(await dappInstance.counter.call(), 0, "after reorg: Counter should be 0... that way we know PISA behaved correctly");
        assert.equal(await dappInstance.inTrouble(), false, "after reorg: inTrouble should be false");

    });

    it('PISA should respond again if there is a reorg', async () => {

        let blockNo = await web3.eth.getBlockNumber();
        channelId = 200;

        await advanceBlock();
        let timestamp = await getCurrentTime();

        createAppointment(dappInstance.address, blockNo, account2, 20, timestamp, 1, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 50), 100, "event Distress(string indexed message)");

        let hash = web3.utils.keccak256(encodedAppointment);
        let cussig = await web3.eth.sign(hash, account2);

        var data = JSON.stringify({
            "challengePeriod": appointment['challengePeriod'],
            "contractAddress": appointment['contractAddress'],
            "customerAddress": appointment['customerAddress'],
            "customerSig": cussig,
            "data": appointment['data'],
            "endBlock": appointment['endBlock'],
            "eventABI": appointment['eventABI'],
            "eventArgs": appointment['eventArgs'],
            "gasLimit": appointment['gasLimit'],
            "id": appointment['id'],
            "jobId": appointment['jobid'],
            "mode": appointment['mode'],
            "paymentHash": appointment['paymentHash'],
            "preCondition": appointment['precondition'],
            "postCondition": appointment['postcondition'],
            "refund": appointment['refund'],
            "startBlock": appointment['startBlock']
        });

        //Book appointment with PISA                           
        let response = await sendData(data);

        //Take a snapshot of the current block, before the event PISA was hired to watch happens
        let snapshot = await snapshotBlock();
        blockNo = await web3.eth.getBlockNumber();
        prevStateID = snapshot['result'];
        prevBlockNo = blockNo;

        //Check that  PISA has not responded
        assert.equal(await dappInstance.counter.call(), 0, "before snapshot: Counter should be 0");
        assert.equal(await dappInstance.inTrouble(), false, "before snapshot: inTrouble should be false");

        //Trigger event that PISA was hired to watch
        await dappInstance.distressCall();

        await timeout(500);

        //Making sure there are enough confirmations
        for (let i = 0; i < 50; i++) {
            await advanceBlock();
            await timeout(500);
        }

        //Timeout as pisa is a live service that is tested
        await timeout(500);

        //Check that PISA has responded after event it was hired to watch for was triggered
        assert.equal(await dappInstance.counter.call(), 1, "After snapshot: Counter should be 1... that way we know PISA did its job");
        assert.equal(await dappInstance.inTrouble(), false, "After snapshot: Should be in TROUBLE");

        //Construct a reorg back from the block we took a snapshot at
        let result = await revertSnapshot(prevStateID);
        blockNo = await web3.eth.getBlockNumber();
        assert.equal(prevBlockNo, blockNo, "checking revert worked");

        //Making sure there are enough confirmations and this fork is longer than the initial one
        for (let i = 0; i < 75; i++) {
            await advanceBlock();
            await timeout(500);
        }

        //Trigger event that PISA was hired to watch
        await dappInstance.distressCall();

        await timeout(500);

        //Making sure there are enough confirmations
        for (let i = 0; i < 50; i++) {
            await advanceBlock();
            await timeout(500);
        }

        //Timeout as pisa is a live service that is tested
        await timeout(500);

        //Check that PISA hasresponded, as in the reorg the event PISA was hired to watch happened again after reorg
        assert.equal(await dappInstance.counter.call(), 1, "after reorg: Counter should be 1... that way we know PISA did its job");
        assert.equal(await dappInstance.inTrouble(), false, "after reorg: inTrouble should be false");

    });

});