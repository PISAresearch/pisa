const PISAHash = artifacts.require("PISAHash");
const MultiChannelContract = artifacts.require("MultiChannelContract");
const DataRegistry = artifacts.require("DataRegistry");
const CommandChannelHandler = artifacts.require("CommandChannelHandler");
const assert = require("chai").assert;
const truffleAssert = require('truffle-assertions');

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
      }, [channelid.toString(), _v]
    );
  }

  if(_mode == 2) {
    return web3.eth.abi.encodeParameters(['uint'], [42]);
  }
}


function createAppointment(_sc, _blockNo, _cus, _v, _jobid, _toCall) {

  let appointmentFinishTime = _blockNo + 100;
  let minChallengePeriod = 50;
  let toCall = createToCall(_toCall, _v);
  let refund = 100; // 100 wei
  let gas = 1000000; // PISA will allocate up to 1m gas for this jobs
  let mode = 0; // We know what dispute handler to use!
  let postcondition = web3.eth.abi.encodeParameter('uint', _v); // Should be "v=3" or more
  let h = web3.utils.keccak256(web3.eth.abi.encodeParameter('uint', 123));

  appointment = new Array();
  appointment['starttime'] = _blockNo;
  appointment['finishtime'] = appointmentFinishTime;
  appointment['cus'] = _cus;
  appointment['minChallengePeriod'] = minChallengePeriod;
  appointment['id'] = channelid;
  appointment['jobid'] = _jobid;
  appointment['toCall'] = toCall;
  appointment['refund'] = refund;
  appointment['gas'] = gas;
  appointment['mode'] = mode;
  appointment['eventDesc'] = "doEvent(uint,uint,uint)";
  appointment['eventVals'] = [1,2,3];
  appointment['postcondition'] = postcondition;
  appointment['h'] = h;
  appointment['r'] = web3.eth.abi.encodeParameter('uint', 123);
  appointment['v'] = _v;

  // address sc; // Address for smart contract
  // address payable cus; // Address for the customer who hired PISA
  // uint[3] memory timers; // [0] Start time for an appointment [1] Agreed finish time and [2] challenge period (minimum length of time for a single dispute)
  // uint[2] memory appointmentinfo; // [0] Appointment ID [1] to keep track of job updates in PISA
  // bytes[] memory data; // [0] Job-specific data (depends whether it is Plasma, Channels, etc) and [1] is the post-condition data to check if dispute resolved as expected
  // uint[3] memory extraData; // [0] Refund value to customer. [1] Gas allocated for job. [3] Dispute handler mode.
  // bytes32 hash; // Customer must reveal pre-image to prove appointment is valid

  let timersArray = new Array();

  timersArray[0] = _blockNo;
  timersArray[1] = appointmentFinishTime;
  timersArray[2] = minChallengePeriod;

  let appointmentinfoArray = new Array();
  // Workaround from https://github.com/ethereum/web3.js/issues/2077#issuecomment-468526280
  // Apparently under-the-hood ether.js cant handle BN very well.
  appointmentinfoArray[0] = channelid.toString();
  appointmentinfoArray[1] = _jobid;

  let jobdata = new Array();
  jobdata[0] = toCall;
  jobdata[1] = postcondition;

  let extraData = new Array();
  extraData[0] = refund;
  extraData[1] = gas;
  extraData[2] = mode;

  let eventData = new Array();
  encodeEventDesc = web3.eth.abi.encodeParameter('string',appointment['eventDesc']);
  encodeEventVal = web3.eth.abi.encodeParameters(['uint','uint','uint'],appointment['eventVals']);
  eventData[0] = encodeEventDesc;
  eventData[1] = encodeEventVal;

  encodedAppointment = web3.eth.abi.encodeParameters(['address','address','uint[3]', "uint[2]", "bytes[2]", "uint[3]","bytes[2]","bytes32"],
                                             [_sc, _cus, timersArray, appointmentinfoArray, jobdata, extraData, eventData, h]);

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

  it('Setup and install watcher', async () => {
    var accounts =  await web3.eth.getAccounts();
    pisaHashInstance = await PISAHash.deployed();
    // Make sure it is set to OK
    let flag = await pisaHashInstance.getFlag.call();
    assert.equal(flag.toNumber(), 0 ,"Flag should be OK = 0");

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
    let isWatcher = await pisaHashInstance.isWatcher.call(accounts[1]);
    assert.isTrue(isWatcher, "Watcher is installed");

    // Fail to install a watcher due to time
    blockNo = blockNo - 10;
    toSign = web3.eth.abi.encodeParameters(['address','uint','address'], [accounts[2], blockNo, pisaHashInstance.address]);
    hash = web3.utils.keccak256(toSign);
    sig =  await web3.eth.sign(hash,accounts[0]);
    await truffleAssert.reverts(pisaHashInstance.installWatcher(accounts[2], blockNo, sig, {from: accounts[3]}), "too late to install");
  });

  it('Install Command Dispute Handler', async () => {
      var disputeHandler = await CommandChannelHandler.deployed();
      var accounts =  await web3.eth.getAccounts();

      // Make sure it is set to OK
      let flag = await pisaHashInstance.getFlag.call();
      assert.equal(flag.toNumber(), 0 ,"Flag should be OK = 0");

      // Some time in the future
      let blockNo = await web3.eth.getBlockNumber();
      blockNo = blockNo + 10;

      // Install a watcher using the cold-storage admin key
      let toSign = web3.eth.abi.encodeParameters(['address','uint','uint', 'address'], [disputeHandler.address, 0, blockNo, pisaHashInstance.address]);
      let hash = web3.utils.keccak256(toSign);
      let sig =  await web3.eth.sign(hash,accounts[0]);
      let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,sig);
      assert.equal(signerAddr, accounts[0], "Signer address should be the same");

      // Ready to install handler
      await pisaHashInstance.installDisputeHandler(disputeHandler.address, 0, blockNo, sig, {from: accounts[2]});

      // Was the handler installed ok?
      let getHandler = await pisaHashInstance.getHandler.call(0);
      assert.equal(getHandler, disputeHandler.address);
    });

    it('Trigger in MultiChannelContract (PISA will resolve)', async () => {
      var challengeInstance = await MultiChannelContract.deployed();
      var registryInstance  = await DataRegistry.deployed();
      var accounts =  await web3.eth.getAccounts();
      let blockNo = await web3.eth.getBlockNumber();

      // Create channel for two accounts
      await challengeInstance.fundChannel(accounts[3], accounts[4], {from: accounts[3]});
      channelid = await challengeInstance.getChannelID.call(accounts[3], accounts[4]);

      // console.log("Channel ID: " + channelid);
      assert.isTrue(channelid != 0, "Channel ID should not be 0");

      // Trigger challenge
      await challengeInstance.trigger(channelid);

      let timenow = await getCurrentTime();
      let shard = await registryInstance.getDataShardIndex.call(timenow);
      let recordHash = await registryInstance.fetchHash.call(shard, challengeInstance.address, channelid, 0);
      assert.isTrue(recordHash.length != 0, "Data should be stored!");

      // Decoded will be block.number, challengePeriod, v
      blockNo = await web3.eth.getBlockNumber();
      let encodedRecord = web3.eth.abi.encodeParameters(["uint","uint","uint","uint"], [0, blockNo, 50, 0]);
      let h = web3.utils.keccak256(encodedRecord);

      assert.equal(recordHash, h, "Trigger record hash for MultiChannelContract should match");

    });

    it('PISA appointment for MultiChannelContract (PISA will resolve)', async () => {
      var challengeInstance = await MultiChannelContract.deployed();
      var registryInstance  = await DataRegistry.deployed();
      var accounts =  await web3.eth.getAccounts();
      let blockNo = await web3.eth.getBlockNumber();

      // Confirm account[1] is a watcher (dependent on previous test)
      let isWatcher = await pisaHashInstance.isWatcher.call(accounts[1]);
      assert.isTrue(isWatcher, "Watcher is installed");

      // Accounts[3] = customer
      // Accounts[1] = watcher
      createAppointment(challengeInstance.address, blockNo, accounts[3], 50, 10, 1);

      appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaHashInstance.address]);
      let hash = web3.utils.keccak256(appointmentToSign);

      cussig =  await web3.eth.sign(hash,accounts[3]);
      let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
      assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

      pisasig =  await web3.eth.sign(hash,accounts[1]);
      signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,pisasig);
      assert.equal(signerAddr, accounts[1], "PISA signer address should be the same");
    });

    it('PISA responds on behalf of customer (PISA will resolve)', async () => {
      let challengeInstance = await MultiChannelContract.deployed();
      let registryInstance  = await DataRegistry.deployed();
      let accounts =  await web3.eth.getAccounts();
      let blockNo = await web3.eth.getBlockNumber();
      let timenow = await getCurrentTime();
      let shard = await registryInstance.getDataShardIndex.call(timenow);

      // PISA MUST RESPOND. Should not fail!
      await pisaHashInstance.respond(encodedAppointment, cussig, {from: accounts[1]});
      let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint'], [challengeInstance.address, appointment['cus'], channelid.toString()]);
      let pisaid = web3.utils.keccak256(pisaidEncoded);

      let pisaRecord = await registryInstance.fetchRecord.call(shard, pisaHashInstance.address, pisaid, 0);
      assert.isTrue(pisaRecord.length != 0, "Data should be stored!");

      let pisa_decoded_record = web3.eth.abi.decodeParameters(["uint", "uint", "uint"], pisaRecord);
      assert.equal(pisa_decoded_record[0], blockNo+1, "Correct block number");
      assert.equal(pisa_decoded_record[1], appointment['jobid'], "Job ID for the appointment should match");
      assert.equal(pisa_decoded_record[2], appointment['gas'], "Allocated gas for call should be here");

      let v = await challengeInstance.getV.call(channelid.toString());
      assert.equal(v, appointment['v'],"v should be 50");
    });

    it('Trigger in MultiChannelContract (PISA will not resolve)', async () => {
      var challengeInstance = await MultiChannelContract.deployed();
      var registryInstance  = await DataRegistry.deployed();
      var accounts =  await web3.eth.getAccounts();
      let blockNo = await web3.eth.getBlockNumber();

      // Create channel for two accounts
      await challengeInstance.fundChannel(accounts[3], accounts[4], {from: accounts[3]});
      channelid = await challengeInstance.getChannelID.call(accounts[3], accounts[4]);

      // console.log("Channel ID: " + channelid);
      assert.isTrue(channelid != 0, "Channel ID should not be 0");

      // Trigger challenge
      await challengeInstance.trigger(channelid);

      let flag = await challengeInstance.getFlag(channelid.toString());
      assert.equal(flag, 1, "Flag is set to challenge");

      let timenow = await getCurrentTime();
      let shard = await registryInstance.getDataShardIndex.call(timenow);
      let recordHash = await registryInstance.fetchHash.call(shard, challengeInstance.address, channelid, 1);
      datashard[0] = shard;
      dataindex[0] = 1;
      assert.isTrue(recordHash.length != 0, "Data should be stored!");

      // Decoded will be block.number, challengePeriod, v
      blockNo = await web3.eth.getBlockNumber();
      encodedLogTrigger = web3.eth.abi.encodeParameters(["uint","uint", "uint", "uint"], [0, blockNo, 50, 50]);
      let h = web3.utils.keccak256(encodedLogTrigger);
      assert.equal(recordHash, h, "Trigger hash from MultiChannelContract should match");

      // Go a few blocks into the future...
      for(let i=0; i<100; i++) {
          await advanceBlock();
      }

      // Resolve dispute...
      await challengeInstance.resolve(channelid.toString());
      flag = await challengeInstance.getFlag(channelid.toString());
      assert.equal(flag, 0, "Flag is set to resolved");

      // OK let's check that the hash matches up
      recordHash = await registryInstance.fetchHash.call(shard, challengeInstance.address, channelid, 2);
      datashard[1] = shard;
      dataindex[1] = 2;
      assert.isTrue(recordHash.length != 0, "Data should be stored!");

      blockNo = await web3.eth.getBlockNumber();
      encodedLogResolve = web3.eth.abi.encodeParameters(["uint","uint", "uint"], [1, blockNo, 51]);
      h = web3.utils.keccak256(encodedLogResolve);
      assert.equal(recordHash, h, "Resolve hash from MultiChannelContract");

    });

    it('PISA appointment for MultiChannelContract (PISA will not resolve)', async () => {
      let challengeInstance = await MultiChannelContract.deployed();
      let registryInstance  = await DataRegistry.deployed();
      let accounts =  await web3.eth.getAccounts();
      let blockNo = await web3.eth.getBlockNumber();

      // Confirm account[1] is a watcher (dependent on previous test)
      let isWatcher = await pisaHashInstance.isWatcher.call(accounts[1]);
      assert.isTrue(isWatcher, "Watcher is installed");

      // Accounts[3] = customer
      // Accounts[1] = watcher
      createAppointment(challengeInstance.address, blockNo-110, accounts[3], 100, 20, 1);

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

    it('Seek recourse against PISA and WIN', async () => {
      // Really we should NEVER be in this situation....
      // accepting a much larger "v" in an earlier receipt... but
      // bugs can happen and we should be protected from it becuase the _jobid
      // remains acceptable
      let challengeInstance = await MultiChannelContract.deployed();
      let registryInstance  = await DataRegistry.deployed();
      let accounts =  await web3.eth.getAccounts();
      let timenow = await getCurrentTime();

      let triggerRecord = await registryInstance.fetchHash.call(datashard[0], challengeInstance.address, channelid.toString(), dataindex[0]);
      assert.isTrue(triggerRecord.length != 0, "Trigger data should be stored!");

      let resolveRecord = await registryInstance.fetchHash.call(datashard[1], challengeInstance.address, channelid.toString(), dataindex[1]);
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

      let pendingRefunds = await pisaHashInstance.getPendingRefunds.call();
      assert.equal(pendingRefunds, 1, "Only 1 refund outstanding");

      // Should revert... we already issued recourse
      await truffleAssert.reverts(pisaHashInstance.recourse(encodedAppointment, sigs, appointment['r'], logdata, datashard, dataindex), "Recourse was already successful");

    });
});
