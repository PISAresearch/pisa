const PISA = artifacts.require("PISA");
const ChallengeClosureContract = artifacts.require("ChallengeClosureContract");
const ChallengeCommandContract = artifacts.require("ChallengeCommandContract");
const DataRegistry = artifacts.require("DataRegistry");
const CloseChannelHandler = artifacts.require("CloseChannelHandler");
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
let appointmentToSign; // Encodes the appointment + PISA contract address
let cussig; // Customer Accounts[3] signature
let pisasig; // PISA Accounts[3] signature

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
          "inputs": [
              {
                 "name": "_v",
                 "type": "uint256"
              }
          ],
          "name": "refute",
          "outputs": [],
          "payable": false,
          "stateMutability": "nonpayable",
          "type": "function"
      }, [_v]
    );
  }

  if(_mode == 2) {
    return web3.eth.abi.encodeParameters(['uint'], [42]);
  }
}


function createAppointment(_sc, _blockNo, _cus, _v, _jobid, _toCall) {

  let appointmentFinishTime = _blockNo + 100;
  let minChallengePeriod = 50;
  let appointmentid = 0;
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
  appointment['id'] = appointmentid;
  appointment['jobid'] = _jobid;
  appointment['toCall'] = toCall;
  appointment['refund'] = refund;
  appointment['gas'] = gas;
  appointment['mode'] = mode;
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
  appointmentinfoArray[0] = appointmentid;
  appointmentinfoArray[1] = _jobid;

  let jobdata = new Array();
  jobdata[0] = toCall;
  jobdata[1] = postcondition;

  let extraData = new Array();
  extraData[0] = refund;
  extraData[1] = gas;
  extraData[2] = mode;

  encodedAppointment = web3.eth.abi.encodeParameters(['address','address','uint[3]', "uint[2]", "bytes[2]", "uint[3]","bytes32"],
                                             [_sc, _cus, timersArray, appointmentinfoArray, jobdata, extraData, h]);

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


contract('PISA', (accounts) => {

  var pisaInstance;

  PISA.new(DataRegistry.address, 2, 300, accounts[0]).then(function(instance) {
     pisaInstance = instance;
  });


  it('Setup and install watcher', async () => {
    var accounts =  await web3.eth.getAccounts();

    // Make sure it is set to OK
    let flag = await pisaInstance.getFlag.call();
    assert.equal(flag.toNumber(), 0 ,"Flag should be OK = 0");

    // Some time in the future
    let blockNo = await web3.eth.getBlockNumber();
    blockNo = blockNo + 10;

    // Install a watcher using the cold-storage admin key.
    let toSign = web3.eth.abi.encodeParameters(['address','uint','address'], [accounts[1], blockNo, pisaInstance.address]);
    let hash = web3.utils.keccak256(toSign);
    var sig =  await web3.eth.sign(hash,accounts[0]);
    let signerAddr = await pisaInstance.recoverEthereumSignedMessage.call(hash,sig);
    assert.equal(signerAddr, accounts[0], "Signer address should be the same");

    await pisaInstance.installWatcher(accounts[1], blockNo, sig, {from: accounts[2]});
    let isWatcher = await pisaInstance.isWatcher.call(accounts[1]);
    assert.isTrue(isWatcher, "Watcher is installed");

    // Fail to install a watcher due to time
    blockNo = blockNo - 10;
    toSign = web3.eth.abi.encodeParameters(['address','uint','address'], [accounts[2], blockNo, pisaInstance.address]);
    hash = web3.utils.keccak256(toSign);
    sig =  await web3.eth.sign(hash,accounts[0]);
    await truffleAssert.reverts(pisaInstance.installWatcher(accounts[2], blockNo, sig, {from: accounts[3]}), "too late to install");
  });

  it('Install Closure Dispute Handler', async () => {
      var disputeHandler = await CloseChannelHandler.deployed();
      var accounts =  await web3.eth.getAccounts();

      // Make sure it is set to OK
      let flag = await pisaInstance.getFlag.call();
      assert.equal(flag.toNumber(), 0 ,"Flag should be OK = 0");

      // Some time in the future
      let blockNo = await web3.eth.getBlockNumber();
      blockNo = blockNo + 10;

      // Install a watcher using the cold-storage admin key
      let toSign = web3.eth.abi.encodeParameters(['address','uint','uint', 'address'], [disputeHandler.address, 0, blockNo, pisaInstance.address]);
      let hash = web3.utils.keccak256(toSign);
      let sig =  await web3.eth.sign(hash,accounts[0]);
      let signerAddr = await pisaInstance.recoverEthereumSignedMessage.call(hash,sig);
      assert.equal(signerAddr, accounts[0], "Signer address should be the same");

      // Ready to install handler
      await pisaInstance.installDisputeHandler(disputeHandler.address, 0, blockNo, sig, {from: accounts[2]});

      // Was the handler installed ok?
      let getHandler = await pisaInstance.getHandler.call(0);
      assert.equal(getHandler, disputeHandler.address);
    });

  it('PISA appointment for closure channel', async () => {
    var challengeInstance = await ChallengeClosureContract.deployed();
    var registryInstance  = await DataRegistry.deployed();
    var accounts =  await web3.eth.getAccounts();
    let blockNo = await web3.eth.getBlockNumber();

    // Confirm account[1] is a watcher (dependent on previous test)
    let isWatcher = await pisaInstance.isWatcher.call(accounts[1]);
    assert.isTrue(isWatcher, "Watcher is installed");

    // Accounts[3] = customer
    // Accounts[1] = watcher
    createAppointment(challengeInstance.address, blockNo, accounts[3], 50, 10, 0);

    appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaInstance.address]);
    let hash = web3.utils.keccak256(appointmentToSign);
    cussig =  await web3.eth.sign(hash,accounts[3]);
    let signerAddr = await pisaInstance.recoverEthereumSignedMessage.call(hash,cussig);
    assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

    pisasig =  await web3.eth.sign(hash,accounts[1]);
    signerAddr = await pisaInstance.recoverEthereumSignedMessage.call(hash,pisasig);
    assert.equal(signerAddr, accounts[1], "PISA signer address should be the same");
  });


  it('No trigger, recourse fails', async () => {
    var challengeInstance = await ChallengeClosureContract.deployed();
    var registryInstance  = await DataRegistry.deployed();
    var accounts =  await web3.eth.getAccounts();
    let datashard = new Array();

    datashard[0] = 0;
    datashard[1] = 0;

    let dataindex = new Array();
    dataindex[0] = 0;
    dataindex[1] = 0;

    let sigs = [pisasig, cussig];
    // It should revert due to failure to decode fetched data from registry (i.e. it doesnt exist, how can we decode it?!)
    await truffleAssert.reverts(pisaInstance.recourse(encodedAppointment, sigs, appointment['r'], datashard, dataindex));

  });

  it('PISA responds to closure channel with evidence', async () => {
    var challengeInstance = await ChallengeClosureContract.deployed();
    var registryInstance  = await DataRegistry.deployed();
    var accounts =  await web3.eth.getAccounts();
    let blockNo = await web3.eth.getBlockNumber();

    // PISA is now hired! Let's issue challenge on ChallengeClosureContract.
    let tx = await challengeInstance.trigger();
    let timenow = await getCurrentTime();
    let shard = await registryInstance.getDataShardIndex.call(timenow);
    let record = await registryInstance.fetchRecord.call(shard, challengeInstance.address, appointment['id'], 0);
    assert.isTrue(record.length != 0, "Data should be stored!");

    // Decoded will be block.number, challengePeriod, v
    let decoded_record = web3.eth.abi.decodeParameters(["uint","uint", "uint", "uint"], record);

    blockNo = await web3.eth.getBlockNumber();
    assert.equal(decoded_record[0], 0, "MsgType=0 means TRIGGER");
    assert.equal(decoded_record[1], blockNo, "Block number recorded");
    assert.equal(decoded_record[2], 50, "Challenge period was hard-coded during migration to 50");
    assert.equal(decoded_record[3], 0, "Initial version is set to 0 in the contract");

    // PISA MUST RESPOND. Should not fail!
    await pisaInstance.recordedResponse(encodedAppointment, cussig, {from: accounts[1]});
    let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint'], [challengeInstance.address, appointment['cus'], appointment['id']]);
    let pisaid = web3.utils.keccak256(pisaidEncoded);

    let pisaRecord = await registryInstance.fetchRecord.call(shard, pisaInstance.address, pisaid, 0);
    assert.isTrue(pisaRecord.length != 0, "Data should be stored!");

    let pisa_decoded_record = web3.eth.abi.decodeParameters(["uint", "uint", "uint"], pisaRecord);
    assert.equal(pisa_decoded_record[0], blockNo+1, "Correct block number");
    assert.equal(pisa_decoded_record[1], appointment['jobid'], "Job ID for the appointment should match");
    assert.equal(pisa_decoded_record[2], appointment['gas'], "Allocated gas for call should be here");

    let v = await challengeInstance.getV.call();
    assert.equal(v, appointment['v'],"v in challenge contract should be 50");

    blockNo = await web3.eth.getBlockNumber();
    // TODO: Go forward in time...
    for(let i=0; i<100; i++) {
      await advanceBlock();
    }

    let newBlockNo = await web3.eth.getBlockNumber();

    assert.equal(newBlockNo-100, blockNo, "Fast-forward 100 blocks didn't work");

    // PISA is now hired! Let's issue challenge on ChallengeClosureContract.
    tx = await challengeInstance.resolve();
    timenow = await getCurrentTime();
    shard = await registryInstance.getDataShardIndex.call(timenow);
    record = await registryInstance.fetchRecord.call(shard, challengeInstance.address, appointment['id'], 1);
    assert.isTrue(record.length != 0, "Data should be stored!");

    // Decoded will be block.number, challengePeriod, v
    decoded_record = web3.eth.abi.decodeParameters(["uint","uint", "uint"], record);

    newBlockNo = await web3.eth.getBlockNumber();
    assert.equal(decoded_record[0], 1, "MsgType=1 means RESOLVE");
    assert.equal(decoded_record[1], newBlockNo, "Block number recorded");
    assert.equal(decoded_record[2], appointment['v'], "Version should be 50");
  });

  it('Trigger occurred, recourse still fails', async () => {
    var challengeInstance = await ChallengeClosureContract.deployed();
    var registryInstance  = await DataRegistry.deployed();
    var accounts =  await web3.eth.getAccounts();
    let timenow = await getCurrentTime();

    // Compute dispute record locators
    let shard = await registryInstance.getDataShardIndex.call(timenow);
    let datashard = new Array();
    datashard[0] = shard;
    datashard[1] = shard;
    let dataindex = new Array();
    dataindex[0] = 0;
    dataindex[1] = 1;

    let triggerRecord = await registryInstance.fetchRecord.call(datashard[0], challengeInstance.address, appointment['id'], dataindex[0]);
    assert.isTrue(triggerRecord.length != 0, "Trigger data should be stored!");

    let resolveRecord = await registryInstance.fetchRecord.call(datashard[1], challengeInstance.address, appointment['id'], dataindex[1]);
    assert.isTrue(resolveRecord.length != 0, "Trigger data should be stored!");

    let sigs = [pisasig, cussig];
    // It should revert due to failure to decode fetched data from registry (i.e. it doesnt exist, how can we decode it?!)
    await truffleAssert.reverts(pisaInstance.recourse(encodedAppointment, sigs, appointment['r'], datashard, dataindex), "PISA was a good tower");
  });

  it('Trigger occurred, old receipt sent (lower jobid and version), recourse still fails', async () => {
    var challengeInstance = await ChallengeClosureContract.deployed();
    var registryInstance  = await DataRegistry.deployed();
    var accounts =  await web3.eth.getAccounts();
    let timenow = await getCurrentTime();

    // Compute dispute record locators
    let shard = await registryInstance.getDataShardIndex.call(timenow);
    let datashard = new Array();
    datashard[0] = shard;
    datashard[1] = shard;
    let dataindex = new Array();
    dataindex[0] = 0;
    dataindex[1] = 1;

    let triggerRecord = await registryInstance.fetchRecord.call(datashard[0], challengeInstance.address, appointment['id'], dataindex[0]);
    assert.isTrue(triggerRecord.length != 0, "Trigger data should be stored!");

    let resolveRecord = await registryInstance.fetchRecord.call(datashard[1], challengeInstance.address, appointment['id'], dataindex[1]);
    assert.isTrue(resolveRecord.length != 0, "Trigger data should be stored!");

    // Increment Version (and decrement jobid) (i.e. v=4, jobid=1).
    // Post-condition should fail, but jobid is the same as customer-signed job request.
    // So it should still revert - this is when PISA signs two receipts with jobid and PISA submitted the lower postcondition.
    createAppointment(challengeInstance.address, appointment['starttime'], accounts[3], 19, 8, 0);
    assert.equal(appointment['jobid'], 8, "Job ID should be updated");

    appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaInstance.address]);
    let hash = web3.utils.keccak256(appointmentToSign);
    pisasig =  await web3.eth.sign(hash,accounts[1]);
    cussig =  await web3.eth.sign(hash,appointment['cus']);

    let sigs = [pisasig, cussig];

    // It should revert due to failure to decode fetched data from registry (i.e. it doesnt exist, how can we decode it?!)
    await truffleAssert.reverts(pisaInstance.recourse(encodedAppointment, sigs, appointment['r'], datashard, dataindex), "PISA was a good tower");

  });

  it('Trigger occurred, invalid v, acceptable jobid, recourse still fails', async () => {
    // Really we should NEVER be in this situation....
    // accepting a much larger "v" in an earlier receipt... but
    // bugs can happen and we should be protected from it becuase the _jobid
    // remains acceptable
    var challengeInstance = await ChallengeClosureContract.deployed();
    var registryInstance  = await DataRegistry.deployed();
    var accounts =  await web3.eth.getAccounts();
    let timenow = await getCurrentTime();

    // Compute dispute record locators
    let shard = await registryInstance.getDataShardIndex.call(timenow);
    let datashard = new Array();
    datashard[0] = shard;
    datashard[1] = shard;
    let dataindex = new Array();
    dataindex[0] = 0;
    dataindex[1] = 1;

    let triggerRecord = await registryInstance.fetchRecord.call(datashard[0], challengeInstance.address, appointment['id'], dataindex[0]);
    assert.isTrue(triggerRecord.length != 0, "Trigger data should be stored!");

    let resolveRecord = await registryInstance.fetchRecord.call(datashard[1], challengeInstance.address, appointment['id'], dataindex[1]);
    assert.isTrue(resolveRecord.length != 0, "Trigger data should be stored!");

    // Still an OLD receipt, but the version is super high (we send 50, but this says we should send 100).
    // Customer agreed later on for us to send 50... thus we should be protected...
    createAppointment(challengeInstance.address, appointment['starttime'], accounts[3], 100, 8, 0);

    assert.equal(appointment['jobid'], 8, "Job ID should be updated");

    appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaInstance.address]);
    let hash = web3.utils.keccak256(appointmentToSign);
    pisasig =  await web3.eth.sign(hash,accounts[1]);
    cussig =  await web3.eth.sign(hash,appointment['cus']);

    let sigs = [pisasig, cussig];
    // It should revert due to failure to decode fetched data from registry (i.e. it doesnt exist, how can we decode it?!)
    await truffleAssert.reverts(pisaInstance.recourse(encodedAppointment, sigs, appointment['r'], datashard, dataindex), "PISA failed post-condition, but PISA sent the job when required");
  });

  it('Trigger occurred, response recorded for accounts[3], but appointment is for accounts[2]. recourse successful', async () => {
    // Really we should NEVER be in this situation....
    // accepting a much larger "v" in an earlier receipt... but
    // bugs can happen and we should be protected from it becuase the _jobid
    // remains acceptable
    var challengeInstance = await ChallengeClosureContract.deployed();
    var registryInstance  = await DataRegistry.deployed();
    var accounts =  await web3.eth.getAccounts();
    let timenow = await getCurrentTime();

    // Compute dispute record locators
    let shard = await registryInstance.getDataShardIndex.call(timenow);
    let datashard = new Array();
    datashard[0] = shard;
    datashard[1] = shard;
    let dataindex = new Array();
    dataindex[0] = 0;
    dataindex[1] = 1;

    let triggerRecord = await registryInstance.fetchRecord.call(datashard[0], challengeInstance.address, appointment['id'], dataindex[0]);
    assert.isTrue(triggerRecord.length != 0, "Trigger data should be stored!");

    let resolveRecord = await registryInstance.fetchRecord.call(datashard[1], challengeInstance.address, appointment['id'], dataindex[1]);
    assert.isTrue(resolveRecord.length != 0, "Trigger data should be stored!");

    // Still an OLD receipt, but the version is super high (we send 50, but this says we should send 100).
    // Customer agreed later on for us to send 50... thus we should be protected...
    createAppointment(challengeInstance.address, appointment['starttime'], accounts[2], 100, 8, 0);

    assert.equal(appointment['jobid'], 8, "Job ID should be updated");

    appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaInstance.address]);
    let hash = web3.utils.keccak256(appointmentToSign);
    pisasig =  await web3.eth.sign(hash,accounts[1]);
    cussig =  await web3.eth.sign(hash,appointment['cus']);

    let sigs = [pisasig, cussig];

    // It should revert due to failure to decode fetched data from registry (i.e. it doesnt exist, how can we decode it?!)
    pisaInstance.recourse(encodedAppointment, sigs, appointment['r'], datashard, dataindex);

    let pendingRefunds = await pisaInstance.getPendingRefunds.call();
    assert.equal(pendingRefunds, 1, "Only 1 refund outstanding");

    // It should revert due to failure to decode fetched data from registry (i.e. it doesnt exist, how can we decode it?!)
    await truffleAssert.reverts(pisaInstance.recourse(encodedAppointment, sigs, appointment['r'], datashard, dataindex), "Recourse was already successful");

  });

  it('PISA responds with BROKEN calldata in appointment', async () => {
    var challengeInstance = await ChallengeClosureContract.deployed();
    var registryInstance  = await DataRegistry.deployed();
    var accounts =  await web3.eth.getAccounts();
    let timenow = await getCurrentTime();

    let shard = await registryInstance.getDataShardIndex.call(timenow);
    let blockNo = await web3.eth.getBlockNumber();
    createAppointment(challengeInstance.address, blockNo, accounts[5], 50, 10, 2);

    assert.equal(appointment['cus'], accounts[5], "Appointment should be created for accounts[5]");

    appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaInstance.address]);
    let hash = web3.utils.keccak256(appointmentToSign);
    let sig =  await web3.eth.sign(hash,accounts[5]);

    // PISA MUST RESPOND. Should not fail!
    await pisaInstance.recordedResponse(encodedAppointment, sig, {from: accounts[1]});

    // Fetch PISA record
    let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint'], [challengeInstance.address, appointment['cus'], appointment['id']]);
    let pisaid = web3.utils.keccak256(pisaidEncoded);

    let pisaRecord = await registryInstance.fetchRecord.call(shard, pisaInstance.address, pisaid, 0);
    assert.isTrue(pisaRecord.length != 0, "Data should be stored!");

    // Decoded will be block.number, challengePeriod, v
    let pisa_decoded_record = web3.eth.abi.decodeParameters(["uint", "uint", "uint"], pisaRecord);

    let newBlockNo = await web3.eth.getBlockNumber();
    assert.equal(pisa_decoded_record[0], newBlockNo, "Record based on most recent block");
    assert.equal(pisa_decoded_record[1], appointment['jobid'], "Should idea should match 10");
    assert.equal(pisa_decoded_record[2], appointment['gas'], "Allocated gas promised to customer");
  });


  it('Trigger occurred, newer receipt for accounts[3] presented (i.e. pisa used old job request), resource successful', async () => {
    // Really we should NEVER be in this situation....
    // accepting a much larger "v" in an earlier receipt... but
    // bugs can happen and we should be protected from it becuase the _jobid
    // remains acceptable
    var challengeInstance = await ChallengeClosureContract.deployed();
    var registryInstance  = await DataRegistry.deployed();
    var accounts =  await web3.eth.getAccounts();
    let timenow = await getCurrentTime();

    // A "new" receipt ... so PISA responded with an old job request! bad pisa!
    createAppointment(challengeInstance.address, appointment['starttime'], accounts[3], 101, 11, 0);

    // Compute dispute record locators
    let shard = await registryInstance.getDataShardIndex.call(timenow);
    let datashard = new Array();
    datashard[0] = shard;
    datashard[1] = shard;
    let dataindex = new Array();
    dataindex[0] = 0;
    dataindex[1] = 1;

    let triggerRecord = await registryInstance.fetchRecord.call(datashard[0], challengeInstance.address, appointment['id'], dataindex[0]);
    assert.isTrue(triggerRecord.length != 0, "Trigger data should be stored!");

    let resolveRecord = await registryInstance.fetchRecord.call(datashard[1], challengeInstance.address, appointment['id'], dataindex[1]);
    assert.isTrue(resolveRecord.length != 0, "Trigger data should be stored!");

    assert.equal(appointment['jobid'], 11, "Job ID should be updated");

    appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaInstance.address]);
    let hash = web3.utils.keccak256(appointmentToSign);
    pisasig =  await web3.eth.sign(hash,accounts[1]);
    cussig =  await web3.eth.sign(hash,appointment['cus']);

    let sigs = [pisasig, cussig];

    // It should revert due to failure to decode fetched data from registry (i.e. it doesnt exist, how can we decode it?!)
    pisaInstance.recourse(encodedAppointment, sigs, appointment['r'], datashard, dataindex);

    let pendingRefunds = await pisaInstance.getPendingRefunds.call();
    assert.equal(pendingRefunds, 2, "Only 1 refund outstanding");

    // It should revert due to failure to decode fetched data from registry (i.e. it doesnt exist, how can we decode it?!)
    await truffleAssert.reverts(pisaInstance.recourse(encodedAppointment, sigs, appointment['r'], datashard, dataindex), "Recourse was already successful");

  });


  it('Refund Account[3], but not Account[2]', async () => {
    var challengeInstance = await ChallengeClosureContract.deployed();
    var registryInstance  = await DataRegistry.deployed();
    var accounts =  await web3.eth.getAccounts();
    let timenow = await getCurrentTime();

    let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint'], [challengeInstance.address, accounts[3], appointment['id']]);
    let pisaid = web3.utils.keccak256(pisaidEncoded);
    await pisaInstance.refundCustomer(pisaid, accounts[3], {from: accounts[1], value: appointment['refund']});

    let pendingRefunds = await pisaInstance.getPendingRefunds.call();
    assert.equal(pendingRefunds, 1, "1 outstanding refund for Accounts[2]");
  });

  it('Forfeit as Account[2] not refunded', async () => {

    for(let i=0; i<500; i++) {
      await advanceBlock();
    }
    var challengeInstance = await ChallengeClosureContract.deployed();
    var registryInstance  = await DataRegistry.deployed();
    var accounts =  await web3.eth.getAccounts();
    let timenow = await getCurrentTime();

    let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint'], [challengeInstance.address, accounts[2], appointment['id']]);
    let pisaid = web3.utils.keccak256(pisaidEncoded);
    await pisaInstance.forfeit(pisaid, accounts[2]);

    let flag = await pisaInstance.getFlag.call();
    assert.equal(flag, 1, "Flag should be set as CHEATED");
  });

  it('Refresh PISA contract', async () => {

    await PISA.new(DataRegistry.address, 2, 300, accounts[0]).then(function(instance) {
       pisaInstance = instance;
    });

    let flag = await pisaInstance.getFlag.call();
    assert.equal(flag,0, "Flag is reset back to OK");

  });

  it('Setup and install watcher - accounts[6]', async () => {
    var accounts =  await web3.eth.getAccounts();

    // Make sure it is set to OK
    let flag = await pisaInstance.getFlag.call();
    assert.equal(flag.toNumber(), 0 ,"Flag should be OK = 0");

    // Some time in the future
    let blockNo = await web3.eth.getBlockNumber();
    blockNo = blockNo + 10;

    // Install a watcher using the cold-storage admin key.
    let toSign = web3.eth.abi.encodeParameters(['address','uint','address'], [accounts[6], blockNo, pisaInstance.address]);
    let hash = web3.utils.keccak256(toSign);
    var sig =  await web3.eth.sign(hash,accounts[0]);

    let signerAddr = await pisaInstance.recoverEthereumSignedMessage.call(hash,sig);
    assert.equal(signerAddr, accounts[0], "Signer address should be the same");
    await pisaInstance.installWatcher(accounts[6], blockNo, sig, {from: accounts[2]});
    let isWatcher = await pisaInstance.isWatcher.call(accounts[6]);
    assert.isTrue(isWatcher, "Watcher is installed");
  });

  it('Install Command Dispute Handler (mode=1)', async () => {
      var disputeHandler = await CommandChannelHandler.deployed();
      var accounts =  await web3.eth.getAccounts();

      // Make sure it is set to OK
      let flag = await pisaInstance.getFlag.call();
      assert.equal(flag.toNumber(), 0 ,"Flag should be OK = 0");

      // Some time in the future
      let blockNo = await web3.eth.getBlockNumber();
      blockNo = blockNo + 10;

      // Install a watcher using the cold-storage admin key
      let toSign = web3.eth.abi.encodeParameters(['address','uint','uint', 'address'], [disputeHandler.address, 1, blockNo, pisaInstance.address]);
      let hash = web3.utils.keccak256(toSign);
      let sig =  await web3.eth.sign(hash,accounts[0]);
      let signerAddr = await pisaInstance.recoverEthereumSignedMessage.call(hash,sig);
      assert.equal(signerAddr, accounts[0], "Signer address should be the same");

      // Ready to install handler
      await pisaInstance.installDisputeHandler(disputeHandler.address, 1, blockNo, sig, {from: accounts[2]});

      // Was the handler installed ok?
      let getHandler = await pisaInstance.getHandler.call(1);
      assert.equal(getHandler, disputeHandler.address);
    });

    it('PISA appointment for command channel', async () => {
      var challengeInstance = await ChallengeCommandContract.deployed();
      var registryInstance  = await DataRegistry.deployed();
      var accounts =  await web3.eth.getAccounts();
      let blockNo = await web3.eth.getBlockNumber();

      // Confirm account[1] is a watcher (dependent on previous test)
      let isWatcher = await pisaInstance.isWatcher.call(accounts[6]);
      assert.isTrue(isWatcher, "Watcher is installed");

      // Accounts[3] = customer
      createAppointment(challengeInstance.address, blockNo, accounts[3], 50, 10, 1);

      appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaInstance.address]);
      let hash = web3.utils.keccak256(appointmentToSign);
      cussig =  await web3.eth.sign(hash,accounts[3]);
      let signerAddr = await pisaInstance.recoverEthereumSignedMessage.call(hash,cussig);
      assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

      pisasig =  await web3.eth.sign(hash,accounts[6]);
      signerAddr = await pisaInstance.recoverEthereumSignedMessage.call(hash,pisasig);
      assert.equal(signerAddr, accounts[6], "PISA signer address should be the same");
    });

    it('PISA responds to command channel with refute', async () => {
      var challengeInstance = await ChallengeCommandContract.deployed();
      var registryInstance  = await DataRegistry.deployed();
      var accounts =  await web3.eth.getAccounts();
      let blockNo = await web3.eth.getBlockNumber();

      // PISA is now hired! Let's issue challenge on ChallengeClosureContract.
      let tx = await challengeInstance.trigger();
      let timenow = await getCurrentTime();
      let shard = await registryInstance.getDataShardIndex.call(timenow);
      let record = await registryInstance.fetchRecord.call(shard, challengeInstance.address, appointment['id'], 0);
      assert.isTrue(record.length != 0, "Data should be stored!");

      let flag = await challengeInstance.getFlag.call();
      assert.equal(flag, 1,"Flag is set to challenge mode");

      // Decoded will be block.number, challengePeriod, v
      let decoded_record = web3.eth.abi.decodeParameters(["uint","uint", "uint", "uint"], record);

      blockNo = await web3.eth.getBlockNumber();
      assert.equal(decoded_record[0], 0, "MsgType=0 means TRIGGER");
      assert.equal(decoded_record[1], blockNo, "Block number recorded");
      assert.equal(decoded_record[2], 50, "Challenge period was hard-coded during migration to 50");
      assert.equal(decoded_record[3], 0, "Initial version is set to 0 in the contract");

      // // PISA MUST RESPOND. Should not fail!
      await pisaInstance.recordedResponse(encodedAppointment, cussig, {from: accounts[6]});
      let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint'], [challengeInstance.address, appointment['cus'], appointment['id']]);
      let pisaid = web3.utils.keccak256(pisaidEncoded);
      let pisaRecord = await registryInstance.fetchRecord.call(shard, pisaInstance.address, pisaid, 0);
      assert.isTrue(pisaRecord.length != 0, "Data should be stored!");

      let pisa_decoded_record = web3.eth.abi.decodeParameters(["uint", "uint", "uint"], pisaRecord);
      assert.equal(pisa_decoded_record[0], blockNo+1, "Correct block number");
      assert.equal(pisa_decoded_record[1], appointment['jobid'], "Job ID for the appointment should match");
      assert.equal(pisa_decoded_record[2], appointment['gas'], "Allocated gas for call should be here");

      let v = await challengeInstance.getV.call();
      assert.equal(v, appointment['v'],"v in challenge contract should be 50");

      flag = await challengeInstance.getFlag.call();
      assert.equal(flag, 0,"Flag is reset back to resolved and the dispute is cancelled");
    });



});
