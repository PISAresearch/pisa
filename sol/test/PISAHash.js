const PISAHash = artifacts.require("PISAHash");
const MultiChannelContract = artifacts.require("MultiChannelContract");
const DataRegistry = artifacts.require("DataRegistry");
const CommandChannelHandler = artifacts.require("CommandChannelHandler");
const MockAuction = artifacts.require("MockAuction");
const MockAuctionHandler = artifacts.require("MockAuctionHandler");
const assert = require("chai").assert;
const truffleAssert = require('truffle-assertions');

var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;

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
            if (err) { return reject(err); }
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
            if (err) { return reject(err); }
            const newBlockHash = web3.eth.getBlock('latest').hash;

            return resolve(newBlockHash)
        });
    });
}

// Stored for long-term use between tests.
let appointment; // Appointment array
let encodedAppointment; // Appointment encoding
let channelid; // Channel ID
let appointmentToSign; // Encodes the appointment + PISA contract address
let cussig; // Customer Accounts[3] signature
let pisasig; // PISA Accounts[3] signature

// Used as evidence to punish PISA.
let encodedLogTrigger;
let encodedLogResolve;
let datashard = new Array();
let dataindex = new Array();

function createToCall(_mode, _v) {

  if(_mode == 0) {
    return web3.eth.abi.encodeFunctionCall(
      {
          "constant": false,
          "inputs": [
              {
                 "name": "_v",
                 "type": "uint256"
              }
          ],
          "name": "evidence",
          "outputs": [],
          "payable": false,
          "stateMutability": "nonpayable",
          "type": "function"
      }, [_v]);
  }

  if(_mode == 1) {
    return web3.eth.abi.encodeFunctionCall(
      {
          "constant": false,
          "inputs": [{
            type: 'bytes32',
            name: '_id'
          },{
            type: 'uint256',
            name: '_v'
          }],
          "name": "refute",
          "outputs": [],
          "payable": false,
          "stateMutability": "nonpayable",
          "type": "function"
      }, [channelid, _v]
    );
  }


    if(_mode == 2) {
      return web3.eth.abi.encodeFunctionCall(
        {
            "constant": false,
            "inputs": [{
              type: 'uint256',
              name: '_id'
            },{
              type: 'uint256',
              name: '_v'
            }],
            "name": "refute",
            "outputs": [],
            "payable": false,
            "stateMutability": "nonpayable",
            "type": "function"
        }, [channelid, _v]
      );
    }

  if(_mode == 2) {
    return web3.eth.abi.encodeParameters(['uint'], [42]);
  }

  if(_mode == 10) {
    return web3.eth.abi.encodeFunctionCall(
      {
          "constant": false,
          "inputs": [{
            type: 'uint256',
            name: '_value'
          },{
            type: 'uint256',
            name: '_r'
          }],
          "name": "revealBid",
          "outputs": [],
          "payable": false,
          "stateMutability": "nonpayable",
          "type": "function"
      }, [200, 123]
    );
  }
}

function createAppointment(_sc, _blockNo, _cus, _v, _jobid, _mode, _precondition, _postcondition, _minChallengePeriod) {

  let endBlock = _blockNo + 100;
  let minChallengePeriod = _minChallengePeriod;
  let mode = _mode; // We know what dispute handler to use!
  let toCall = createToCall(mode, _v);
  let refund = "100"; // 100 wei
  let gas = "1000000"; // PISA will allocate up to 1m gas for this jobs
  let h = web3.utils.keccak256(web3.utils.fromAscii("on-the-house"));

  appointment = new Array();
  appointment['startBlock'] = _blockNo;
  appointment['endBlock'] = endBlock;
  appointment['customerAddress'] = _cus;
  appointment['id'] = channelid;
  appointment['jobid'] = _jobid;
  appointment['data'] = toCall;
  appointment['refund'] = refund;
  appointment['gasLimit'] = gas;
  appointment['mode'] = mode;
  appointment['eventABI'] = "event doEvent(uint indexed, uint indexed, uint)";
  appointment['eventArgs'] = web3.eth.abi.encodeParameters(['uint[]', 'uint'], [[0], 2]);
  appointment['precondition'] = _precondition;
  appointment['postcondition'] = _postcondition;
  appointment['paymentHash'] = h;
  appointment['r'] = web3.utils.fromAscii("on-the-house");
  appointment['v'] = _v;
  appointment['challengePeriod'] = minChallengePeriod;
  appointment['contractAddress'] = _sc;

  bytesEventABI = web3.utils.fromAscii(appointment['eventABI']);
  appointment['eventArgs'] = appointment['eventArgs'];

  let encodeAppointmentInfo = web3.eth.abi.encodeParameters(['uint','uint','uint','uint','uint','uint', 'bytes32'], [appointment['id'], appointment['jobid'], appointment['startBlock'], appointment['endBlock'], appointment['challengePeriod'], appointment['refund'], appointment['paymentHash']]);
  let encodeContractInfo = web3.eth.abi.encodeParameters(['address','address','uint', 'bytes'], [appointment['contractAddress'], appointment['customerAddress'], appointment['gasLimit'], appointment['data']]);
  let encodeConditions = web3.eth.abi.encodeParameters(['bytes','bytes','bytes','bytes', 'uint'], [bytesEventABI, appointment['eventArgs'], appointment['precondition'], appointment['postcondition'], appointment['mode']]);

  encodedAppointment =  web3.eth.abi.encodeParameters(['bytes','bytes','bytes'],[encodeAppointmentInfo, encodeContractInfo, encodeConditions]);
}


module.exports = {
    advanceTime,
    advanceBlock,
    advanceTimeAndBlock
}

function getCurrentTime() {
    return new Promise(function(resolve) {
      web3.eth.getBlock("latest").then(function(block) {
            resolve(block.timestamp)
        });
    })
}

function timeout(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }


contract('PISAHash', (accounts) => {

  // var pisaHashInstance;
  let pisaHashInstance;
  //
  // PISAHash.new(DataRegistry.address, 2, 300, accounts[0]).then(function(instance) {
  //    pisaHashInstance = instance;
  // });

  function sendData(data) {
      return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            var url = "http://18.219.31.158:5487/appointment";
            xhr.open("POST", url, true);
            xhr.setRequestHeader("Content-Type", "application/json");
            xhr.onreadystatechange = function () {
               if (this.readyState == 4 && this.status == 200) {
                  var json = JSON.parse(xhr.responseText);

                  resolve(xhr.responseText);
              }

            };

            xhr.send(data);
      });
  }


  // it('External API test', async () => {
  //   var challengeInstance = await MultiChannelContract.deployed();
  //   pisaHashInstance = await PISAHash.deployed();
  //   let blockNo = await web3.eth.getBlockNumber();
  //   channelid = 200;
  // 
  //   await advanceBlock();
  //   let timestamp = await getCurrentTime();
  //
  //   createAppointment(challengeInstance.address, blockNo, accounts[3], 20, timestamp, 2, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 50), 100);
  //   let hash = web3.utils.keccak256(encodedAppointment);
  //
  //   // console.log(hash);
  //   cussig =  await web3.eth.sign(hash,accounts[3]);
  //
  //   // hash = "0x0000000000000000000000000000000000000000";
  //   // cussig = "0x38dc3260470ba83851138b16122e33108682edf4a03d2f3262da5f975f6bc217734f9d1b4cf9cf7226b53f04ba3a042c23aa0a96eb58c7e2084c9f2f7865aeee01";
  //   let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
  //   // console.log(signerAddr);
  //   assert.equal(signerAddr, accounts[3], "Signer address should be the same");
  //   // assert.equal(signerAddr, accounts[3], "Signer address should be the same");
  //
  //   var data = JSON.stringify({"challengePeriod": appointment['challengePeriod'],
  //                              "contractAddress": appointment['contractAddress'],
  //                              "customerAddress": appointment['customerAddress'],
  //                              "customerSig": cussig,
  //                              "data": appointment['data'],
  //                              "endBlock": appointment['endBlock'],
  //                              "eventABI": appointment['eventABI'],
  //                              "eventArgs": appointment['eventArgs'],
  //                              "gasLimit": appointment['gasLimit'],
  //                              "id": appointment['id'],
  //                              "jobId": appointment['jobid'],
  //                              "mode": appointment['mode'],
  //                              "paymentHash": appointment['paymentHash'],
  //                              "preCondition": appointment['precondition'],
  //                              "postCondition": appointment['postcondition'],
  //                              "refund": appointment['refund'],
  //                              "startBlock": appointment['startBlock']});
  //
  //
  //     let response = await sendData(data);
  //     var json = JSON.parse(response);
  //     assert.isTrue(json['contractAddress'] == appointment['contractAddress'], "Response contract address should be the same");
  //
  // });

  it('Setup and install watcher', async () => {
    var accounts =  await web3.eth.getAccounts();
    pisaHashInstance = await PISAHash.deployed();
    // Make sure it is set to OK
    let flag = await pisaHashInstance.flag.call();
    assert.equal(flag.toNumber(), 0 ,"Flag should be OK = 0");

    // Go a few blocks into the future...
    // So we can "inspect the past" safely
    for(let i=0; i<100; i++) {
        await advanceBlock();
    }
    // Some time in the future
    let blockNo = await web3.eth.getBlockNumber();
    blockNo = blockNo + 10;

    // Install a watcher using the cold-storage admin key.
    let toSign = web3.eth.abi.encodeParameters(['address','uint','address'], [accounts[1], blockNo, pisaHashInstance.address]);
    let hash = web3.utils.keccak256(toSign);
    var sig =  await web3.eth.sign(hash,accounts[0]);
    let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,sig);
    assert.equal(signerAddr, accounts[0], "Signer address should be the same");

    await pisaHashInstance.installWatcher(accounts[1], blockNo, sig, {from: accounts[2]});
    let isWatcher = await pisaHashInstance.watchers.call(accounts[1]);
    assert.isTrue(isWatcher, "Watcher is installed");

    // Fail to install a watcher due to time
    blockNo = blockNo - 10;
    toSign = web3.eth.abi.encodeParameters(['address','uint','address'], [accounts[2], blockNo, pisaHashInstance.address]);
    hash = web3.utils.keccak256(toSign);
    sig =  await web3.eth.sign(hash,accounts[0]);
    await truffleAssert.reverts(pisaHashInstance.installWatcher(accounts[2], blockNo, sig, {from: accounts[3]}), "too late to install");
  });

  it('Fund channel accounts[3] <-> accounts[4] in MultiChannelContract by accounts[3]', async () => {
    var challengeInstance = await MultiChannelContract.deployed();
    // Create channel for two accounts
    await challengeInstance.fundChannel(accounts[3], accounts[4], {from: accounts[3]});
    channelid = await challengeInstance.getChannelID.call(accounts[3], accounts[4]);
    assert.isTrue(channelid != "0", "Channel ID should not be 0");
  });

  it('Install Condition Handlers', async () => {
      var postconditionHandler = await CommandChannelHandler.deployed();
      var accounts =  await web3.eth.getAccounts();

      // Make sure it is set to OK
      let flag = await pisaHashInstance.flag.call();
      assert.equal(flag.toNumber(), 0 ,"Flag should be OK = 0");

      // Some time in the future
      let blockNo = await web3.eth.getBlockNumber();
      blockNo = blockNo + 10;

      // Install a watcher using the cold-storage admin key
      let toSign = web3.eth.abi.encodeParameters(['address', 'address', 'address', 'uint','uint', 'address'], ["0x0000000000000000000000000000000000000000", postconditionHandler.address, postconditionHandler.address, 1, blockNo, pisaHashInstance.address]);
      let hash = web3.utils.keccak256(toSign);
      let sig =  await web3.eth.sign(hash,accounts[0]);
      let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,sig);
      assert.equal(signerAddr, accounts[0], "Signer address should be the same");

      // Ready to install handler
      await pisaHashInstance.installMode("0x0000000000000000000000000000000000000000", postconditionHandler.address, postconditionHandler.address, 1, blockNo, sig, {from: accounts[2]});

      // Was the handler installed ok?
      let getMode = await pisaHashInstance.getMode.call(1);
      assert.equal(getMode[0][1], postconditionHandler.address);
    });

    it('Basic test (PISA will respond OK) - Create a PISA appointment for MultiChannelContract (v=20, jobid=9)', async () => {
      var challengeInstance = await MultiChannelContract.deployed();
      var registryInstance  = await DataRegistry.deployed();
      var accounts =  await web3.eth.getAccounts();
      let blockNo = await web3.eth.getBlockNumber();

      // Confirm account[1] is a watcher (dependent on previous test)
      let isWatcher = await pisaHashInstance.watchers.call(accounts[1]);
      assert.isTrue(isWatcher, "Watcher is installed");

      // Accounts[3] = customer
      // Accounts[1] = watcher
      createAppointment(challengeInstance.address, blockNo, accounts[3], 20, 9, 1, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 50), 50);

      appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaHashInstance.address]);
      let hash = web3.utils.keccak256(appointmentToSign);

      cussig =  await web3.eth.sign(hash,accounts[3]);
      let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
      assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

      pisasig =  await web3.eth.sign(hash,accounts[1]);
      signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,pisasig);
      assert.equal(signerAddr, accounts[1], "PISA signer address should be the same");
    });

    it('Basic test (PISA will respond OK) - Trigger in MultiChannelContract', async () => {
      var challengeInstance = await MultiChannelContract.deployed();
      var registryInstance  = await DataRegistry.deployed();
      var accounts =  await web3.eth.getAccounts();
      let blockNo = await web3.eth.getBlockNumber();

      // Trigger challenge
      await challengeInstance.trigger(channelid);

      blockNo = await web3.eth.getBlockNumber();
      let shard = await registryInstance.getDataShardIndex.call(blockNo);

      let recordHash = await registryInstance.fetchHash.call(shard, challengeInstance.address, channelid, 0);
      assert.isTrue(recordHash.length != 0, "Data should be stored!");

      // Decoded will be block.number, challengePeriod, v
      blockNo = await web3.eth.getBlockNumber();
      let encodedRecord = web3.eth.abi.encodeParameters(["uint","uint","uint","uint"], [0, blockNo, 50, 0]);
      let h = web3.utils.keccak256(encodedRecord);

      assert.equal(recordHash, h, "Trigger record hash for MultiChannelContract should match");

    });

    it('Basic test (PISA will respond OK) - PISA responds on behalf of customer (v=20, jobid=9)', async () => {
      let challengeInstance = await MultiChannelContract.deployed();
      let registryInstance  = await DataRegistry.deployed();
      let accounts =  await web3.eth.getAccounts();

      // PISA MUST RESPOND. Should not fail!
      await pisaHashInstance.respond(encodedAppointment, cussig, {from: accounts[1]});

      let blockNo = await web3.eth.getBlockNumber();
      let shard = await registryInstance.getDataShardIndex.call(blockNo);

      let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint'], [challengeInstance.address, appointment['customerAddress'], channelid]);
      let pisaid = web3.utils.keccak256(pisaidEncoded);

      let pisaRecord = await registryInstance.fetchRecords.call(shard, pisaHashInstance.address, pisaid);
      let lastElement = pisaRecord.length - 1;

      // TODO: We should decode to "bytes" not "bytes32", getting a 53 bits error.
      let pisa_decoded_record = web3.eth.abi.decodeParameters(["uint", "bytes32"], pisaRecord[lastElement]);
      assert.equal(pisa_decoded_record[0], blockNo, "Response block number");

      console.log(channelid);
      let v = await challengeInstance.getV.call(channelid);
      assert.equal(v, appointment['v'],"v should be 20");

      let sigs = [pisasig, cussig];
      let channelrecords = await registryInstance.fetchHashes.call(shard, challengeInstance.address, channelid);

      // Duplicating record hash check (from previous test) to confirm we have the right data.
      let encodedLog = web3.eth.abi.encodeParameters(["uint", "uint", "uint", "uint"], [0, blockNo-1, 50, 0]);
      let h = web3.utils.keccak256(encodedLog);
      assert.equal(channelrecords[0], h, "Trigger hash should match");
      assert.isTrue(channelrecords.length == 1, "Refute does not create a log... so only 1 log");

      let tempLogData = new Array();
      tempLogData[0] = encodedLog;
      let tempDataShard = new Array();
      tempDataShard[0] = shard;
      let tempDataIndex = new Array();
      tempDataIndex[0] = lastElement;

      // Go a few blocks into the future...
      for(let i=0; i<150; i++) {
          await advanceBlock();
      }

      // We lack enough information to perform recourse...
      await truffleAssert.reverts(pisaHashInstance.recourse(encodedAppointment, sigs, appointment['r'], tempLogData, tempDataShard, tempDataIndex), "No data shard or index given");

    });

    it('PISA will NOT respond - Trigger dispute in MultiChannelContract (v=20, jobid=9)', async () => {
      var challengeInstance = await MultiChannelContract.deployed();
      var registryInstance  = await DataRegistry.deployed();
      var accounts =  await web3.eth.getAccounts();
      let blockNo = await web3.eth.getBlockNumber();


      // Trigger challenge
      await challengeInstance.trigger(channelid);

      let flag = await challengeInstance.getFlag(channelid);
      assert.equal(flag, 1, "Flag is set to challenge");

      blockNo = await web3.eth.getBlockNumber();
      let shard = await registryInstance.getDataShardIndex.call(blockNo);
      datashard[0] = shard;
      let recordHashes = await registryInstance.fetchHashes.call(shard, challengeInstance.address, channelid);
      dataindex[0] = recordHashes.length-1;
      assert.isTrue(recordHashes.length != 0, "Data should be stored!");

      // Decoded will be block.number, challengePeriod, v
      encodedLogTrigger = web3.eth.abi.encodeParameters(["uint","uint", "uint", "uint"], [0, blockNo, 50, 20]);
      let h = web3.utils.keccak256(encodedLogTrigger);
      assert.equal(recordHashes[dataindex[0]], h, "Trigger hash from MultiChannelContract should match");

      // Go a few blocks into the future...
      for(let i=0; i<105; i++) {
          await advanceBlock();
      }

      // Resolve dispute...
      await challengeInstance.resolve(channelid);
      flag = await challengeInstance.getFlag(channelid);
      assert.equal(flag, 0, "Flag is set to resolved");

      // OK let's check that the hash matches up
      blockNo = await web3.eth.getBlockNumber();
      shard = await registryInstance.getDataShardIndex.call(blockNo);
      datashard[1] = shard;
      recordHashes = await registryInstance.fetchHashes.call(shard, challengeInstance.address, channelid);
      dataindex[1] = recordHashes.length-1;
      assert.isTrue(recordHashes.length != 0, "Data should be stored!");

      encodedLogResolve = web3.eth.abi.encodeParameters(["uint","uint", "uint"], [1, blockNo, 21]);
      let hash1 = web3.utils.keccak256(encodedLogResolve);
      assert.equal(recordHashes[dataindex[1]], hash1, "Resolve hash from MultiChannelContract should match");

    });

    it('PISA will NOT respond - Seek recourse against PISA and FAIL due to bad minimum challenge time (v=100, jobid=20)', async () => {
      let challengeInstance = await MultiChannelContract.deployed();
      let registryInstance  = await DataRegistry.deployed();
      let accounts =  await web3.eth.getAccounts();
      let blockNo = await web3.eth.getBlockNumber();

      // Accounts[3] = customer
      // Accounts[1] = watcher
      createAppointment(challengeInstance.address, blockNo-110, accounts[3], 100, 20, 1, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 100), 100);
      appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaHashInstance.address]);

      // Customer signs job
      let hash = web3.utils.keccak256(appointmentToSign);
      cussig =  await web3.eth.sign(hash,accounts[3]);
      let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
      assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

      // PISA signs job
      pisasig =  await web3.eth.sign(hash,accounts[1]);
      signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,pisasig);
      assert.equal(signerAddr, accounts[1], "PISA signer address should be the same");

      // Combine signatures.... produced in previous test.
      let sigs = [pisasig, cussig];
      let logdata = new Array();
      logdata[0] = encodedLogTrigger;
      logdata[1] = encodedLogResolve;

      // console.log(logdata);
      // console.log(datashard[0].toString() + " " + datashard[1].toString());
      // console.log(dataindex);

      // // It should revert due to failure to decode fetched data from registry (i.e. it doesnt exist, how can we decode it?!)
      await truffleAssert.reverts(pisaHashInstance.recourse(encodedAppointment, sigs, appointment['r'], logdata, datashard, dataindex), "Contract did not abide by minimum challenge time");

      // Confirm there are no outstanding refunds
      let pendingRefunds = await pisaHashInstance.pendingrefunds.call();
      assert.equal(pendingRefunds, 0, "Should be no outstanding refunds");
    });

    it('PISA will NOT respond - Seek recourse against PISA and FAIL due to dispute happening before start time (v=100, jobid=20)', async () => {
      let challengeInstance = await MultiChannelContract.deployed();
      let registryInstance  = await DataRegistry.deployed();
      let accounts =  await web3.eth.getAccounts();
      let blockNo = await web3.eth.getBlockNumber();

      // Accounts[3] = customer
      // Accounts[1] = watcher
      createAppointment(challengeInstance.address, blockNo-100, accounts[3], 100, 20, 1, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 100), 50);
      appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaHashInstance.address]);

      // Customer signs job
      let hash = web3.utils.keccak256(appointmentToSign);
      cussig =  await web3.eth.sign(hash,accounts[3]);
      let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
      assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

      // PISA signs job
      pisasig =  await web3.eth.sign(hash,accounts[1]);
      signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,pisasig);
      assert.equal(signerAddr, accounts[1], "PISA signer address should be the same");

      let triggerRecord = await registryInstance.fetchHash.call(datashard[0], challengeInstance.address, channelid, dataindex[0]);
      assert.isTrue(triggerRecord.length != 0, "Trigger data should be stored!");

      let resolveRecord = await registryInstance.fetchHash.call(datashard[1], challengeInstance.address, channelid, dataindex[1]);
      assert.isTrue(resolveRecord.length != 0, "Resolve data should be stored!");

      // Combine signatures.... produced in previous test.
      let sigs = [pisasig, cussig];
      let logdata = new Array();
      logdata[0] = encodedLogTrigger;
      logdata[1] = encodedLogResolve;

      // // It should revert due to failure to decode fetched data from registry (i.e. it doesnt exist, how can we decode it?!)
      await truffleAssert.reverts(pisaHashInstance.recourse(encodedAppointment, sigs, appointment['r'], logdata, datashard, dataindex), "Dispute started before appointment time....");

      // Confirm there are no outstanding refunds
      let pendingRefunds = await pisaHashInstance.pendingrefunds.call();
      assert.equal(pendingRefunds, 0, "Should be no outstanding refunds");
    });

    it('PISA will NOT respond - Seek recourse against PISA and FAIL due to dispute happening after finish time (v=100, jobid=20)', async () => {
      let challengeInstance = await MultiChannelContract.deployed();
      let registryInstance  = await DataRegistry.deployed();
      let accounts =  await web3.eth.getAccounts();
      let blockNo = await web3.eth.getBlockNumber();

      // Accounts[3] = customer
      // Accounts[1] = watcher
      createAppointment(challengeInstance.address, blockNo-210, accounts[3], 100, 20, 1, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 100), 50);

      appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaHashInstance.address]);

      // Customer signs job
      let hash = web3.utils.keccak256(appointmentToSign);
      cussig =  await web3.eth.sign(hash,accounts[3]);
      let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
      assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

      // PISA signs job
      pisasig =  await web3.eth.sign(hash,accounts[1]);
      signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,pisasig);
      assert.equal(signerAddr, accounts[1], "PISA signer address should be the same");

      let triggerRecord = await registryInstance.fetchHash.call(datashard[0], challengeInstance.address, channelid, dataindex[0]);
      assert.isTrue(triggerRecord.length != 0, "Trigger data should be stored!");

      let resolveRecord = await registryInstance.fetchHash.call(datashard[1], challengeInstance.address, channelid, dataindex[1]);
      assert.isTrue(resolveRecord.length != 0, "Resolve data should be stored!");

      // Combine signatures.... produced in previous test.
      let sigs = [pisasig, cussig];
      let logdata = new Array();
      logdata[0] = encodedLogTrigger;
      logdata[1] = encodedLogResolve;

      // // It should revert due to failure to decode fetched data from registry (i.e. it doesnt exist, how can we decode it?!)
      await truffleAssert.reverts(pisaHashInstance.recourse(encodedAppointment, sigs, appointment['r'], logdata, datashard, dataindex), "Dispute started after appointment time...");

      // Confirm there are no outstanding refunds
      let pendingRefunds = await pisaHashInstance.pendingrefunds.call();
      assert.equal(pendingRefunds, 0, "Should be no outstanding refunds");
    });


    it('PISA will NOT respond - Creates a valid PISA appointment for MultiChannelContract (v=100, jobid=20)', async () => {
      let challengeInstance = await MultiChannelContract.deployed();
      let registryInstance  = await DataRegistry.deployed();
      let accounts =  await web3.eth.getAccounts();
      let blockNo = await web3.eth.getBlockNumber();

      // Confirm account[1] is a watcher (dependent on previous test)
      let isWatcher = await pisaHashInstance.watchers.call(accounts[1]);
      assert.isTrue(isWatcher, "Watcher is installed");

      // Accounts[3] = customer
      // Accounts[1] = watcher
      createAppointment(challengeInstance.address, blockNo-110, accounts[3], 100, 20, 1, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 100), 50);
      appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaHashInstance.address]);

      // Customer signs job
      let hash = web3.utils.keccak256(appointmentToSign);
      cussig =  await web3.eth.sign(hash,accounts[3]);
      let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
      assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

      // PISA signs job
      pisasig =  await web3.eth.sign(hash,accounts[1]);
      signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,pisasig);
      assert.equal(signerAddr, accounts[1], "PISA signer address should be the same");
    });

    it('PISA will NOT respond - Customer seeks recourse using valid receipt against PISA and they win', async () => {
      // Really we should NEVER be in this situation....
      // accepting a much larger "v" in an earlier receipt... but
      // bugs can happen and we should be protected from it becuase the _jobid
      // remains acceptable
      let challengeInstance = await MultiChannelContract.deployed();
      let registryInstance  = await DataRegistry.deployed();
      let accounts =  await web3.eth.getAccounts();

      let triggerRecord = await registryInstance.fetchHash.call(datashard[0], challengeInstance.address, channelid, dataindex[0]);
      assert.isTrue(triggerRecord.length != 0, "Trigger data should be stored!");

      let resolveRecord = await registryInstance.fetchHash.call(datashard[1], challengeInstance.address, channelid, dataindex[1]);
      assert.isTrue(resolveRecord.length != 0, "Resolve data should be stored!");

      // Combine signatures.... produced in previous test.
      let sigs = [pisasig, cussig];
      let logdata = new Array();
      logdata[0] = encodedLogTrigger;
      logdata[1] = encodedLogResolve;

      let hash = web3.utils.keccak256(appointmentToSign);
      let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
      assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

      pisasig =  await web3.eth.sign(hash,accounts[1]);
      signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,pisasig);
      assert.equal(signerAddr, accounts[1], "PISA signer address should be the same");

      // // It should revert due to failure to decode fetched data from registry (i.e. it doesnt exist, how can we decode it?!)
      await pisaHashInstance.recourse(encodedAppointment, sigs, appointment['r'], logdata, datashard, dataindex);

      let pendingRefunds = await pisaHashInstance.pendingrefunds.call();
      assert.equal(pendingRefunds, 1, "Only 1 refund outstanding");

      // Should revert... we already issued recourse
      await truffleAssert.reverts(pisaHashInstance.recourse(encodedAppointment, sigs, appointment['r'], logdata, datashard, dataindex), "Recourse was already successful");

    });

    it('PISA will NOT respond - PISA refunds the customer 100 wei', async () => {
      // Really we should NEVER be in this situation....
      // accepting a much larger "v" in an earlier receipt... but
      // bugs can happen and we should be protected from it becuase the _jobid
      // remains acceptable
      let accounts =  await web3.eth.getAccounts();
      let challengeInstance = await MultiChannelContract.deployed();
      let registryInstance  = await DataRegistry.deployed();

      let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint'], [challengeInstance.address, appointment['customerAddress'], channelid]);
      let pisaid = web3.utils.keccak256(pisaidEncoded);

      await truffleAssert.reverts(pisaHashInstance.forfeit(pisaid), "Time has not yet passed since refund was due by PISA");

      await truffleAssert.reverts(pisaHashInstance.refundCustomer(challengeInstance.address, appointment['customerAddress'], channelid, {value: 99}), "PISA must refund the exact value");
      await pisaHashInstance.refundCustomer(challengeInstance.address, appointment['customerAddress'], channelid, {value: 100});

      let pendingRefunds = await pisaHashInstance.pendingrefunds.call();
      assert.equal(pendingRefunds, 0, "No more pending refunds... all good!");

      // Confirm the logs are updated appropriately
      let cheatedlog = await pisaHashInstance.cheated.call(pisaid);
      assert.isTrue(!cheatedlog['triggered'], "Cheating log should no longer be triggered");
      assert.equal(cheatedlog['jobid'].toString(), appointment['jobid'], "Job ID should match up");
      assert.equal(cheatedlog['refund'].toString(), "0", "Refund should be set to 0... coins already in PISA Contract");
      assert.equal(cheatedlog['refundby'].toString(), "0", "No longer set as RefundBy");

      let refundRecorded = await pisaHashInstance.refunds.call(appointment['customerAddress']);
      assert.equal(refundRecorded.toString(), "100", "100 wei refund should be recorded");

      // Again, issuing the same evidence should fail too
      let triggerRecord = await registryInstance.fetchHash.call(datashard[0], challengeInstance.address, channelid, dataindex[0]);
      assert.isTrue(triggerRecord.length != 0, "Trigger data should be stored!");

      let resolveRecord = await registryInstance.fetchHash.call(datashard[1], challengeInstance.address, channelid, dataindex[1]);
      assert.isTrue(resolveRecord.length != 0, "Resolve data should be stored!");

      let sigs = [pisasig, cussig];
      let logdata = new Array();
      logdata[0] = encodedLogTrigger;
      logdata[1] = encodedLogResolve;
      await truffleAssert.reverts(pisaHashInstance.recourse(encodedAppointment, sigs, appointment['r'], logdata, datashard, dataindex), "Recourse was already successful");


    });

    it('PISA will NOT respond - Try recourse again with same evidence, fails as it was already issued', async () => {
      // Really we should NEVER be in this situation....
      // accepting a much larger "v" in an earlier receipt... but
      // bugs can happen and we should be protected from it becuase the _jobid
      // remains acceptable
      let accounts =  await web3.eth.getAccounts();
      let challengeInstance = await MultiChannelContract.deployed();
      let registryInstance  = await DataRegistry.deployed();

      let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint'], [challengeInstance.address, appointment['customerAddress'], channelid]);
      let pisaid = web3.utils.keccak256(pisaidEncoded);

      // Again, issuing the same evidence should fail too
      let triggerRecord = await registryInstance.fetchHash.call(datashard[0], challengeInstance.address, channelid, dataindex[0]);
      assert.isTrue(triggerRecord.length != 0, "Trigger data should be stored!");

      let resolveRecord = await registryInstance.fetchHash.call(datashard[1], challengeInstance.address, channelid, dataindex[1]);
      assert.isTrue(resolveRecord.length != 0, "Resolve data should be stored!");

      let sigs = [pisasig, cussig];
      let logdata = new Array();
      logdata[0] = encodedLogTrigger;
      logdata[1] = encodedLogResolve;
      await truffleAssert.reverts(pisaHashInstance.recourse(encodedAppointment, sigs, appointment['r'], logdata, datashard, dataindex), "Recourse was already successful");
    });

    it('PISA will NOT respond - Bad withdrawal followed by the customer withdrawing their coins', async () => {
      // Really we should NEVER be in this situation....
      // accepting a much larger "v" in an earlier receipt... but
      // bugs can happen and we should be protected from it becuase the _jobid
      // remains acceptable
      let challengeInstance = await MultiChannelContract.deployed();
      let accounts =  await web3.eth.getAccounts();
      let blockNo = await web3.eth.getBlockNumber();

      // Prepare the signed withdraw message from the customer
      let withdrawmsg = web3.eth.abi.encodeParameters(['address', 'uint', 'uint', 'address'], [accounts[4], 100, blockNo, pisaHashInstance.address]);
      let withdrawhash = web3.utils.keccak256(withdrawmsg);

      // Lets do a bad withdrawal first
      let badwithdrawsig =  await web3.eth.sign(withdrawhash,accounts[9]);

      // Perform the withdraw
      await truffleAssert.reverts(pisaHashInstance.withdraw(accounts[4], 100, blockNo, accounts[3], badwithdrawsig), "Customer did not authorise this withdrawal");

      let withdrawsig =  await web3.eth.sign(withdrawhash,accounts[3]);
      let signer = await pisaHashInstance.recoverEthereumSignedMessage.call(withdrawhash,withdrawsig);
      assert.equal(signer, accounts[3], "Customer must sign withdrawal");

      let refunds = await pisaHashInstance.refunds.call(accounts[3]);
      assert.equal(refunds,100," Customer should be expecting 100 wei refund");

      // Perform the withdraw
      await pisaHashInstance.withdraw(accounts[4], 100, blockNo, accounts[3], withdrawsig);

      // Did it work?
      let pisabalance = await web3.eth.getBalance(pisaHashInstance.address);
      assert.equal(pisabalance.toString(), "0", "Refund sould be issued & no coins left in the PISA contract" );
      refunds = await pisaHashInstance.refunds.call(accounts[3]);
      assert.equal(refunds, 0," Customer should be refunded ");

      // Double-check cheat log....
      let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint'], [challengeInstance.address, appointment['customerAddress'], channelid]);
      let pisaid = web3.utils.keccak256(pisaidEncoded);
      let cheatedlog = await pisaHashInstance.cheated.call(pisaid);
      assert.isTrue(!cheatedlog['triggered'], "Cheating log should no longer be triggered");
      assert.equal(cheatedlog['jobid'].toString(), appointment['jobid'], "Job ID should match up");
      assert.equal(cheatedlog['refund'].toString(), "0", "Refund should be set to 0... coins already in PISA Contract");
      assert.equal(cheatedlog['refundby'].toString(), "0", "No longer set as RefundBy");

    });


    it('Accountable Relay Transaction - Install mode handler so PISA has to respond between time t1 and t2', async () => {
        var accounts =  await web3.eth.getAccounts();

        // Make sure it is set to OK
        let flag = await pisaHashInstance.flag.call();
        assert.equal(flag.toNumber(), 0 ,"Flag should be OK = 0");

        // Some time in the future
        let blockNo = await web3.eth.getBlockNumber();
        blockNo = blockNo + 10;

        // Install a watcher using the cold-storage admin key
        let toSign = web3.eth.abi.encodeParameters(['address', 'address', 'address', 'uint','uint', 'address'], ["0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", 2, blockNo, pisaHashInstance.address]);
        let hash = web3.utils.keccak256(toSign);
        let sig =  await web3.eth.sign(hash,accounts[0]);
        let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,sig);
        assert.equal(signerAddr, accounts[0], "Signer address should be the same");

        // Ready to install handler
        await pisaHashInstance.installMode("0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", 2, blockNo, sig, {from: accounts[2]});

        // Was the handler installed ok?
        let getMode;
        (getMode) = await pisaHashInstance.getMode.call(2);

        assert.equal(getMode[0][0], "0x0000000000000000000000000000000000000000", "No precondition should be installed");
        assert.equal(getMode[0][1], "0x0000000000000000000000000000000000000000", "No postcondition should be installed");
        assert.equal(getMode[0][2], "0x0000000000000000000000000000000000000000", "No challenge time should be installed");
        assert.isTrue(getMode[1]);

      });

      it('Invalid External Call - PISA responds on behalf of customer', async () => {
        let challengeInstance = await MultiChannelContract.deployed();
        let registryInstance  = await DataRegistry.deployed();
        let accounts =  await web3.eth.getAccounts();
        let blockNo = await web3.eth.getBlockNumber();
        let shard = await registryInstance.getDataShardIndex.call(blockNo);

        createAppointment(challengeInstance.address, blockNo, accounts[3], 21, 10, 2, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 50), 50);
        appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaHashInstance.address]);
        // PISA MUST RESPOND. Should not fail!
        // await truffleAssert.reverts(pisaHashInstance.respond(encodedAppointment, cussig, {from: accounts[1]}), "PISA response cancelled as customer did not authorise this job");
        let h = web3.utils.keccak256(appointmentToSign);

        // OK so we need customer to sign it...
        let tempcussig =  await web3.eth.sign(h,accounts[3]);
        let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(h,tempcussig);
        assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

        await pisaHashInstance.respond(encodedAppointment, tempcussig, {from: accounts[1]});
        let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint'], [challengeInstance.address, appointment['customerAddress'], channelid]);
        let pisaid = web3.utils.keccak256(pisaidEncoded);

        // Fetch record... execution should have failed, but record still kept.
        let pisaRecords = await registryInstance.fetchRecords.call(shard, pisaHashInstance.address, pisaid);
        assert.isTrue(pisaRecords.length != 0, "Data should be stored!");
        let lastElement = pisaRecords.length - 1; // Easier to read doing this...

        // TODO: We should decode to "bytes" not "bytes32", getting a 53 bits error.
        let pisa_decoded_record = web3.eth.abi.decodeParameters(["uint", "uint", "bytes32"], pisaRecords[lastElement]);
        assert.equal(pisa_decoded_record[0], blockNo+1, "Response block number");
        assert.equal(pisa_decoded_record[1], appointment['jobid'], "Jobid should be the same");
        assert.equal(pisa_decoded_record[2], web3.utils.keccak256(encodedAppointment), "Hash of appointment should be logged");

      });

      it('Accountable Relay Transaction - Sign appointment to send tx between t1 adn t2', async () => {
          let challengeInstance = await MultiChannelContract.deployed();
          var accounts =  await web3.eth.getAccounts();
          let blockNo = await web3.eth.getBlockNumber();

          // Accounts[3] = customer
          // Accounts[1] = watcher
          createAppointment(challengeInstance.address, blockNo, accounts[3], 150, 28, 2, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 150), 50);

          appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaHashInstance.address]);
          let hash = web3.utils.keccak256(appointmentToSign);

          cussig =  await web3.eth.sign(hash,accounts[3]);
          let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
          assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

          pisasig =  await web3.eth.sign(hash,accounts[1]);
          signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,pisasig);
          assert.equal(signerAddr, accounts[1], "PISA signer address should be the same");
      });

      it('Accountable Relay Transaction - Customer issue recourse for jobid 28 (successful)', async () => {
          var accounts =  await web3.eth.getAccounts();
          let challengeInstance = await MultiChannelContract.deployed();

          // Go a few blocks into the future...
          for(let i=0; i<150; i++) {
              await advanceBlock();
          }

          // We really only need signed appointment + both sigs
          let sigs = [pisasig, cussig];
          let logdata = new Array()
          let datashard = new Array();
          let dataindex = new Array();

          let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint'], [challengeInstance.address, appointment['customerAddress'], channelid]);
          let pisaid = web3.utils.keccak256(pisaidEncoded);

          let cheatedlog = await pisaHashInstance.cheated.call(pisaid);

          // Cheated log should be not triggered or resolved!
          assert.isTrue(!cheatedlog['triggered'], "A cheat log should not yet be triggered");
          assert.isTrue(!cheatedlog['resolved'], "Cheat log should not yet be resolved ");

          // Recourse should work.... all we care is if PISA called a function between two times.
          // But it didnt and no log was recorded. Bad PISA.
          await pisaHashInstance.recourse(encodedAppointment, sigs, appointment['r'], logdata, datashard, dataindex);

          // One refund should be pending
          let pendingRefunds = await pisaHashInstance.pendingrefunds.call();
          assert.equal(pendingRefunds, 1, "Only 1 refund outstanding");

          cheatedlog = await pisaHashInstance.cheated.call(pisaid);

          // Cheated log should be resolved now!
          assert.isTrue(cheatedlog['triggered'], "Cheatlog should be triggered now");
          assert.isTrue(!cheatedlog['resolved'], "Cheatlog should be not resolved now");

      });

      it('Accountable Relay Transaction - PISA provides appointment (with same jobid 28) signed by customer. PISA fails to cancel recourse', async () => {
          var accounts =  await web3.eth.getAccounts();
          let challengeInstance = await MultiChannelContract.deployed();
          let blockNo = await web3.eth.getBlockNumber();

          // Change Job ID to something in the future.
          createAppointment(challengeInstance.address, blockNo, accounts[3], 200, 28, 2, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 200), 50);

          // OK lets try to compute pisaid locally after creating a new appointment
          let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint'], [challengeInstance.address, appointment['customerAddress'], channelid]);
          let pisaid = web3.utils.keccak256(pisaidEncoded);
          let cheatedlog = await pisaHashInstance.cheated.call(pisaid);
          assert.isTrue(cheatedlog['triggered'], "Recourse for job id 28 should be triggered");
          assert.isTrue(!cheatedlog['resolved'], "Recourse for job id 28 should not already be resolved");

          appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaHashInstance.address]);
          let hash = web3.utils.keccak256(appointmentToSign);

          cussig =  await web3.eth.sign(hash,accounts[3]);
          let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
          assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

          // Prove customer has approved a new appointment from us.
          await truffleAssert.reverts(pisaHashInstance.cancelledAppointment(encodedAppointment, cussig), "PISA submitted an older appointment");

          // One refund should be pending
          let pendingRefunds = await pisaHashInstance.pendingrefunds.call();
          cheatedlog = await pisaHashInstance.cheated.call(pisaid);
          assert.equal(pendingRefunds, 1, "1 refund should be outstanding");
          assert.isTrue(cheatedlog['triggered'], "Recourse for job id 28 should be triggered");
      });

      it('Accountable Relay Transaction - PISA provides signed (by customer) appointment with new jobid (30), cancels recourse ', async () => {
          var accounts =  await web3.eth.getAccounts();
          let challengeInstance = await MultiChannelContract.deployed();
          let blockNo = await web3.eth.getBlockNumber();

          // Change Job ID to something in the future.
          createAppointment(challengeInstance.address, blockNo, accounts[3], 200, 30, 2, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 200), 50);

          // OK lets try to compute pisaid locally after creating a new appointment
          let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint'], [challengeInstance.address, appointment['customerAddress'], channelid]);
          let pisaid = web3.utils.keccak256(pisaidEncoded);
          let cheatedlog = await pisaHashInstance.cheated.call(pisaid);
          assert.isTrue(cheatedlog['triggered'], "Recourse for job id 28 should be triggered");
          assert.isTrue(!cheatedlog['resolved'], "Recourse for job id 28 should not already be resolved");

          appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaHashInstance.address]);
          let hash = web3.utils.keccak256(appointmentToSign);

          cussig =  await web3.eth.sign(hash,accounts[3]);
          let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
          assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

          // Prove customer has approved a new appointment from us.
          await pisaHashInstance.cancelledAppointment(encodedAppointment, cussig);

          // One refund should be pending
          let pendingRefunds = await pisaHashInstance.pendingrefunds.call();
          cheatedlog = await pisaHashInstance.cheated.call(pisaid);
          assert.equal(pendingRefunds, 0, "No refund outstanding");
          assert.isTrue(!cheatedlog['triggered'], "Cheat log for PISAID should no longer be in a triggered mode, its been resolved peacefullyblock");
      });

      it('Accountable Relay Transaction - Customer gets new signed receipt & broadcasts immediately. Should fail. (jobid 35)', async () => {
          var accounts =  await web3.eth.getAccounts();
          let challengeInstance = await MultiChannelContract.deployed();
          let blockNo = await web3.eth.getBlockNumber();

          // Change Job ID to something in the future.
          createAppointment(challengeInstance.address, blockNo, accounts[3], 200, 35, 2, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 200), 50);
          let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint'], [challengeInstance.address, appointment['customerAddress'], channelid]);
          let pisaid = web3.utils.keccak256(pisaidEncoded);

          // PISA + Customer signs new appointment
          appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaHashInstance.address]);
          let hash = web3.utils.keccak256(appointmentToSign);

          pisasig =  await web3.eth.sign(hash,accounts[1]);
          let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,pisasig);
          assert.equal(signerAddr, accounts[1], "PISA signer address should be the same");

          cussig =  await web3.eth.sign(hash,accounts[3]);
          signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
          assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

          let sigs = [pisasig, cussig];
          let logdata = new Array();
          let datashard = new Array();
          let dataindex = new Array();

          await truffleAssert.reverts(pisaHashInstance.recourse(encodedAppointment, sigs, appointment['r'], logdata, datashard, dataindex), "PISA still has time to finish the job");
      });

      it('Precondition Test - Install handler for Auctions', async () => {
          var accounts =  await web3.eth.getAccounts();
          let mockAuctionHandler = await MockAuctionHandler.deployed();
          let blockNo = await web3.eth.getBlockNumber();

          // Install a watcher using the cold-storage admin key
          let toSign = web3.eth.abi.encodeParameters(['address', 'address', 'address', 'uint','uint', 'address'], [mockAuctionHandler.address, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", 10, blockNo+10, pisaHashInstance.address]);
          let hash = web3.utils.keccak256(toSign);
          let sig =  await web3.eth.sign(hash,accounts[0]);
          let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,sig);
          assert.equal(signerAddr, accounts[0], "Signer address should be the same");

          await pisaHashInstance.installMode(mockAuctionHandler.address, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", 10, blockNo+10, sig, {from: accounts[2]});

      });


      // Next TWO tests let us check whether the "precondition" functionality works
      // Really, PISA shouldn't respond until the auction is in "REVEALBID" mode.
      // So this test should try before the mode and the call fails
      // In the next call.... we change the mode and the call will work! yay!
      it('Precondition Test - PISA signs new appointment for AUCTION and PISA responds too early (test precondition - jobid 37)', async () => {
          var accounts =  await web3.eth.getAccounts();
          let mockAuction = await MockAuction.deployed();
          let mockAuctionHandler = await MockAuctionHandler.deployed();
          let blockNo = await web3.eth.getBlockNumber();

          // Change Job ID to something in the future.
          createAppointment(mockAuction.address, blockNo-10, accounts[3], 500, 37, 10, mockAuctionHandler.address, "0x0000000000000000000000000000000000000000", 50);

          appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaHashInstance.address]);
          let hash = web3.utils.keccak256(appointmentToSign);

          cussig =  await web3.eth.sign(hash,accounts[3]);
          let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
          assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

          pisasig =  await web3.eth.sign(hash,accounts[1]);
          signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,pisasig);
          assert.equal(signerAddr, accounts[1], "PISA signer address should be the same");

          // Go a few blocks into the future...
          for(let i=0; i<5; i++) {
              await advanceBlock();
          }

          await truffleAssert.reverts(pisaHashInstance.respond(encodedAppointment, cussig, {from: accounts[1]}));

      });

      it('Precondition Test - MockAuction flag transitions and PISA response works ', async () => {
          var accounts =  await web3.eth.getAccounts();
          let mockAuction = await MockAuction.deployed();
          let mockAuctionHandler = await MockAuctionHandler.deployed();
          let blockNo = await web3.eth.getBlockNumber();

          // Transition flag... so we can now start to reveal the big!
          await mockAuction.transitionFlag();

          let flag = await mockAuction.getAuctionFlag.call();

          assert.equal(flag,1,"Flag should be set to REVEALBID");

          await pisaHashInstance.respond(encodedAppointment, cussig, {from: accounts[1]});

          let lastSender = await mockAuction.lastSender.call();

          assert.equal(lastSender, pisaHashInstance.address, "PISA should be recorded as the immediate caller...");
      });

      it('Precondition Test - PISA signs new appointment and responds for customer after some time', async () => {
          var accounts =  await web3.eth.getAccounts();
          let challengeInstance = await MultiChannelContract.deployed();
          let registryInstance  = await DataRegistry.deployed();
          let blockNo = await web3.eth.getBlockNumber();

          // Change Job ID to something in the future.
          createAppointment(challengeInstance.address, blockNo-10, accounts[3], 500, 40, 2, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 500), 50);

          appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaHashInstance.address]);
          let hash = web3.utils.keccak256(appointmentToSign);

          cussig =  await web3.eth.sign(hash,accounts[3]);
          let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
          assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

          pisasig =  await web3.eth.sign(hash,accounts[1]);
          signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,pisasig);
          assert.equal(signerAddr, accounts[1], "PISA signer address should be the same");

          // Go a few blocks into the future...
          for(let i=0; i<5; i++) {
              await advanceBlock();
          }

          await pisaHashInstance.respond(encodedAppointment, cussig, {from: accounts[1]});

          let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint'], [challengeInstance.address, appointment['customerAddress'], channelid]);
          let pisaid = web3.utils.keccak256(pisaidEncoded);
          blockNo = await web3.eth.getBlockNumber();
          let shard = await registryInstance.getDataShardIndex.call(blockNo);

          // Lets fetch the record (either shard 0 or 1)
          let shardaddr = await registryInstance.getDataShardAddress(blockNo);
          let pisaRecords = await registryInstance.fetchRecords.call(shard, pisaHashInstance.address, pisaid);
          let index = pisaRecords.length - 1;
          let decodedRecord;
          decodedRecord = web3.eth.abi.decodeParameters(['uint','uint','bytes32'], pisaRecords[index]);
          assert.equal(decodedRecord[0], blockNo, "Record on blockchain should correspond to most recent block");
          assert.equal(decodedRecord[1], appointment['jobid'], "Recorded jobid should match up with appointment ID");
          assert.equal(decodedRecord[2], web3.utils.keccak256(encodedAppointment), "Appointment hash should match");

      });

      it('Precondition Test - Customer issue recourse for jobid 40 (PISA responded, recourse fails)', async () => {
          var accounts =  await web3.eth.getAccounts();
          let challengeInstance = await MultiChannelContract.deployed();
          let registryInstance  = await DataRegistry.deployed();

          // Go a few blocks into the future...
          for(let i=0; i<150; i++) {
              await advanceBlock();
          }

          // Confirm the record is still here and it has not been deleted by the DataRegistry
          let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint'], [challengeInstance.address, appointment['customerAddress'], channelid]);
          let pisaid = web3.utils.keccak256(pisaidEncoded);
          let blockNo = await web3.eth.getBlockNumber();
          let shard = await registryInstance.getDataShardIndex.call(blockNo-150);

          let shardaddr = await registryInstance.getDataShardAddress(blockNo-150);

          let pisaRecords = await registryInstance.fetchRecords.call(shard, pisaHashInstance.address, pisaid, {gas: 5000000});
          let index = pisaRecords.length - 1;
          let decodedRecord;

          decodedRecord = web3.eth.abi.decodeParameters(['uint','uint','bytes32'], pisaRecords[index]);

          assert.equal(decodedRecord[2], web3.utils.keccak256(encodedAppointment), "Appointment hash should match");
          assert.equal(decodedRecord[1], appointment['jobid'], "Recorded jobid should match up with appointment ID");
          assert.equal(decodedRecord[0], blockNo-150, "Record on blockchain should correspond to most recent block");

          // OK so the log is still there.... lets try to perform recourse using the same appointment
          // We really only need signed appointment + both sigs
          let sigs = [pisasig, cussig];
          let logdata = new Array()
          let datashard = new Array();
          let dataindex = new Array();
          let cheatedlog = await pisaHashInstance.cheated.call(pisaid);

          // Cheated log should be triggered, but not resolved!
          assert.isTrue(!cheatedlog['triggered']);
          assert.isTrue(!cheatedlog['resolved']);

          // PISA did its job. Recourse should fail.
          await truffleAssert.reverts(pisaHashInstance.recourse(encodedAppointment, sigs, appointment['r'], logdata, datashard, dataindex), "PISA sent the right job during the appointment time");

          // No refund should be pending
          let pendingRefunds = await pisaHashInstance.pendingrefunds.call();
          assert.equal(pendingRefunds, 0, "No refunds outstanding");

          cheatedlog = await pisaHashInstance.cheated.call(pisaid);

          // Cheated log NOT be trigred OR resolved!
          assert.isTrue(!cheatedlog['triggered']);
          assert.isTrue(!cheatedlog['resolved']);

      });

      it('Precondition Test - Fast forward to the future.... the PISA response record has disappeared.... this should still fail!', async () => {
          var accounts =  await web3.eth.getAccounts();
          let challengeInstance = await MultiChannelContract.deployed();
          let registryInstance  = await DataRegistry.deployed();

          var interval = await registryInstance.getInterval.call();

          for(let i=0; i<interval.toNumber()*2; i++) {
            await advanceBlock();
          }

          // Confirm the record is still here and it has not been deleted by the DataRegistry
          let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint'], [challengeInstance.address, appointment['customerAddress'], channelid]);
          let pisaid = web3.utils.keccak256(pisaidEncoded);
          let blockNo = await web3.eth.getBlockNumber();

          // Confirm the record is indeed deleted...
          let pisaRecord = await registryInstance.fetchRecord.call(0, pisaHashInstance.address, pisaid, 0);
          assert.equal(pisaRecord, null, "No record should be found");
          pisaRecord = await registryInstance.fetchRecord.call(1, pisaHashInstance.address, pisaid, 0);
          assert.equal(pisaRecord, null, "No record should be found");

          // OK so the log is still there.... lets try to perform recourse using the same appointment
          // We really only need signed appointment + both sigs
          let sigs = [pisasig, cussig];
          let logdata = new Array()
          let datashard = new Array();
          let dataindex = new Array();
          let cheatedlog = await pisaHashInstance.cheated.call(pisaid);

          // Cheated log should be triggered, but not resolved!
          assert.isTrue(!cheatedlog['triggered']);
          assert.isTrue(!cheatedlog['resolved']);

          // PISA did its job. Recourse should fail.
          await truffleAssert.reverts(pisaHashInstance.recourse(encodedAppointment, sigs, appointment['r'], logdata, datashard, dataindex), "PISA log is likely deleted, so unfair to seek recourse");

          // No refund should be pending
          let pendingRefunds = await pisaHashInstance.pendingrefunds.call();
          assert.equal(pendingRefunds, 0, "No refunds outstanding");

          cheatedlog = await pisaHashInstance.cheated.call(pisaid);

          // Cheated log NOT be trigred OR resolved!
          assert.isTrue(!cheatedlog['triggered']);
          assert.isTrue(!cheatedlog['resolved']);

      });

      it('Precondition Test - PISA signs new appointment, PISA does not respond or refund. Customer forfeits us', async () => {
          var accounts =  await web3.eth.getAccounts();
          let challengeInstance = await MultiChannelContract.deployed();
          let registryInstance  = await DataRegistry.deployed();
          let blockNo = await web3.eth.getBlockNumber();

          // Change Job ID to something in the future.
          createAppointment(challengeInstance.address, blockNo-10, accounts[3], 1230, 50, 2, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 1230), 50);

          appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaHashInstance.address]);
          let hash = web3.utils.keccak256(appointmentToSign);

          cussig =  await web3.eth.sign(hash,accounts[3]);
          let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
          assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

          pisasig =  await web3.eth.sign(hash,accounts[1]);
          signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,pisasig);
          assert.equal(signerAddr, accounts[1], "PISA signer address should be the same");

          // Go a few blocks into the future...
          for(let i=0; i<150; i++) {
              await advanceBlock();
          }

          let logdata = new Array();
          let datashard = new Array();
          let dataindex = new Array();
          let sigs = [pisasig, cussig];

          await pisaHashInstance.recourse(encodedAppointment, sigs, appointment['r'], logdata, datashard, dataindex);

          let pendingRefunds = await pisaHashInstance.pendingrefunds.call();
          assert.equal(pendingRefunds, 1, "1 refund should be outstanding");

          // Go a few blocks into the future...
          for(let i=0; i<300; i++) {
              await advanceBlock();
          }

          // We have missed the refund period.... make us forfeit!!
          let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint'], [challengeInstance.address, appointment['customerAddress'], channelid]);
          let pisaid = web3.utils.keccak256(pisaidEncoded);

          await pisaHashInstance.forfeit(pisaid);

          let flag = await pisaHashInstance.flag.call();
          assert.equal(flag, 1, "PISA should be in the cheated state");

      });

      it('FAIL SAFE - let us recover with distributed agreement', async () => {
          var accounts =  await web3.eth.getAccounts();
          let challengeInstance = await MultiChannelContract.deployed();
          let registryInstance  = await DataRegistry.deployed();
          let blockNo = await web3.eth.getBlockNumber();

          let encoded = web3.eth.abi.encodeParameters(['address','string'],[pisaHashInstance.address, "frozen"]);
          let hash = web3.utils.keccak256(encoded);
          let sig1 =  await web3.eth.sign(hash,accounts[7]);
          let signerAddr1 = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,sig1);
          assert.equal(signerAddr1, accounts[7], "Defender[7] address should be the same");

          let sig2 =  await web3.eth.sign(hash,accounts[9]);
          let signerAddr2 = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,sig2);
          assert.equal(signerAddr2, accounts[9], "Defender[9] address should be the same");

          await pisaHashInstance.failSafe([sig1,sig2],[2,4]);

          let flag = await pisaHashInstance.flag.call();
          assert.equal(flag, 0, "PISA should be back to the OK state");


      });
});
