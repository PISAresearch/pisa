const PISA = artifacts.require("PISA");
const DataRegistry = artifacts.require("DataRegistry");
const assert = require("chai").assert;
const truffleAssert = require('truffle-assertions');

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
  it('Three watchers deposit 1 ether into PISA', async () => {
    var pisaInstance = await PISA.deployed();
    var accounts =  await web3.eth.getAccounts();

    // No deposit should be registered
    var flag = await pisaInstance.getFlag(accounts[0]);
    assert.equal(flag.toString(),"0", "Watcher1 flag set to NODEPOSIT");

    flag = await pisaInstance.getFlag(accounts[1]);
    assert.equal(flag.toString(),"0", "Watcher2 flag set to NODEPOSIT");

    // Setting up WATCHER 1's deposit
    var result = await pisaInstance.sendDeposit({from: accounts[0],value: '1000000000000000000'});
    var balance = await pisaInstance.getDepositBalance(accounts[0]);
    flag = await pisaInstance.getFlag(accounts[0]);

    // Deposit registered
    assert.equal(balance.toString(),"1000000000000000000", "Deposit accepted by PISA");

    // OK flag set
    assert.equal(flag.toString(),"1", "Watcher flag set to OK");

    // Setting up WATCHER 2's deposit
    result = await pisaInstance.sendDeposit({from: accounts[1],value: '1000000000000000000'});
    var balance = await pisaInstance.getDepositBalance(accounts[1]);
    flag = await pisaInstance.getFlag(accounts[1]);

    // Deposit registered
    assert.equal(balance.toString(),"1000000000000000000", "Deposit accepted by PISA");

    // OK flag set
    assert.equal(flag.toString(),"1", "Watcher flag set to OK");

    // Setting up WATCHER 3's deposit
    result = await pisaInstance.sendDeposit({from: accounts[4],value: '1000000000000000000'});
    var balance = await pisaInstance.getDepositBalance(accounts[4]);
    flag = await pisaInstance.getFlag(accounts[4]);

    // Deposit registered
    assert.equal(balance.toString(),"1000000000000000000", "Deposit accepted by PISA");

    // OK flag set
    assert.equal(flag.toString(),"1", "Watcher flag set to OK");
  });

  it('Stop monitoring (fail and success to withdraw)', async () => {
    var pisaInstance = await PISA.deployed();
    var accounts =  await web3.eth.getAccounts();
    var flag = await pisaInstance.getFlag(accounts[0])
    assert.equal(flag.toString(),"1", "Watcher flag set to OK");

    var result = await pisaInstance.stopmonitoring({from: accounts[0]});

    flag = await pisaInstance.getFlag(accounts[0]);
    assert.equal(flag.toString(),"3", "Watcher flag set to CLOSING");

    await truffleAssert.reverts(pisaInstance.withdraw({from: accounts[0]}), "Must wait longer");

    await timeout(3000);

    result = await pisaInstance.withdraw({from: accounts[0]});

    // Closed successfully - deposit sent!
    flag = await pisaInstance.getFlag(accounts[0]);
    assert.equal(flag.toString(),"4", "Watcher flag set to CLOSED");

    var balance = await pisaInstance.getDepositBalance(accounts[0]);
    assert.equal(balance.toString(),"0", "Deposit accepted by PISA");

  });

  it('Record closure dispute and recourse should succeed', async () => {
    var pisaInstance = await PISA.deployed();
    var registryInstance = await DataRegistry.deployed();
    var accounts =  await web3.eth.getAccounts();

    // Current time (latest block)
    var timenow = await getCurrentTime();

    // Set up values for the signed receipt
    let i = 2;
    let s = 218931289;
    let h = web3.utils.soliditySha3({t: 'uint', v:s});

    // Dispute time window
    let disputestart = timenow-100;
    let disputeend = timenow;
    let encoded = web3.eth.abi.encodeParameters(['uint','uint','uint'], [disputestart,disputeend,i]);

    // Store a dispute from accounts[3]
    var result = await registryInstance.setData(encoded, {from: accounts[3]});
    var block = await web3.eth.getBlock(result['receipt']['blockNumber']);
    let shard = await registryInstance.getDataShardIndex.call(disputeend);

    // Receipt
    let r1start = disputestart-1; // BEFORE DISPUTE
    let r1end = disputeend+1; // AFTER DISPUTE

    // PISA signs bad receipt
    let receipt1 = web3.utils.soliditySha3({t: 'uint', v: 0}, {t: 'uint', v: r1start}, {t: 'uint', v:r1end}, {t: 'address', v:accounts[3]}, {t: 'uint', v:i+1}, {t:'bytes32', v:h}, {t:'address', v:pisaInstance.address});
    signature = await web3.eth.sign(receipt1, accounts[1]);

    // Signature should verify OK for bad receipt
    // sigtest = await pisaInstance.test(r1start, r1end, accounts[3], i+1, h, signature, accounts[1]);
    // assert.equal(sigtest,true,"Signature for receipt should verify OK" );

    // Test recourse - PISA should be at fault!
    recourse = await pisaInstance.recourse.call(0,r1start, r1end, accounts[3], i+1, h, s, signature, accounts[1], shard);
    assert.equal(recourse,true,"recourse successful, PISA was at fault" );

    var txresult = await pisaInstance.recourse(0,r1start, r1end, accounts[3], i+1, h, s, signature, accounts[1], shard, {from:accounts[3]});

    // Check flag for accounts[1] watcher and try to withdraw deposit
    flag = await pisaInstance.getFlag(accounts[1]);
    assert.equal(flag.toString(),"2", "Watcher flag set to CHEATED");
    await truffleAssert.reverts(pisaInstance.withdraw({from:accounts[1]}), "Flag is not closing");

  });

  it('Record closure dispute and recourse should fail', async () => {
    var pisaInstance = await PISA.deployed();
    var registryInstance = await DataRegistry.deployed();
    var accounts =  await web3.eth.getAccounts();

    // Current time (latest block)
    var timenow = await getCurrentTime();

    // Set up values for the signed receipt
    let i = 2;
    let s = 12312;
    let h = web3.utils.soliditySha3({t: 'uint', v:s});

    // Dispute time window
    let disputestart = timenow-100;
    let disputeend = timenow;

    // Store a dispute
    let encoded = web3.eth.abi.encodeParameters(['uint','uint','uint'], [disputestart,disputeend,i]);
    var result = await registryInstance.setData(encoded, {from: accounts[2]});
    var block = await web3.eth.getBlock(result['receipt']['blockNumber']);

    let shard = await registryInstance.getDataShardIndex.call(disputeend);

    // Receipt 1 times
    let r1start = disputestart-2; // BEFORE DISPUTE
    let r1end = disputeend-1; // BEFORE DISPUTE

    // Receipt 2 times
    let r2start = disputestart+1; // IN DISPUTE
    let r2end = disputeend+1; // AFTER DISPUTE

    // Receipt 3 times (INVALID RECEIPT)
    let r3start = disputestart+1; // IN DISPUTE
    let r3end = disputestart-1; // BEFORE DISPUTE

    // Receipt 1
    let receipt1 = web3.utils.soliditySha3({t: 'uint', v: 0},{t: 'uint', v: r1start}, {t: 'uint', v:r1end}, {t: 'address', v:accounts[2]}, {t: 'uint', v:i}, {t:'bytes32', v:h}, {t:'address', v:pisaInstance.address});
    var signature = await web3.eth.sign(receipt1, accounts[4]);

    // Signature should verify OK for receipt 1
    // let sigtest = await pisaInstance.test(r1start, r1end, accounts[2], i, h, signature, accounts[4]);
    // assert.equal(sigtest,true,"Signature for receipt1 should verify OK" );

    var recourse = await pisaInstance.recourse.call(0,r1start, r1end, accounts[2], i, h, s, signature, accounts[4], shard);
    assert.equal(recourse,false,"recourse failed, PISA was not at fault as receipt expired before dispute started" );

    // Receipt 2
    let receipt2 = web3.utils.soliditySha3({t: 'uint', v: 0}, {t: 'uint', v: r2start}, {t: 'uint', v:r2end}, {t: 'address', v:accounts[2]}, {t: 'uint', v:i+1}, {t:'bytes32', v:h}, {t:'address', v:pisaInstance.address});
    signature = await web3.eth.sign(receipt2, accounts[4]);

    // // Signature should verify OK for bad receipt
    // sigtest = await pisaInstance.test(r2start, r2end, accounts[2], i+1, h, signature, accounts[4]);
    // assert.equal(sigtest,true,"Signature for receipt2 should verify OK" );

    // Test recourse - PISA should be at fault!
    recourse = await pisaInstance.recourse.call(0, r2start, r2end, accounts[2], i+1, h, s, signature, accounts[4], shard);
    assert.equal(recourse,false,"recourse , PISA was at fault, PISA as receipt was signed as dispute was in progress" );

    // Receipt 3
    let receipt3 = web3.utils.soliditySha3({t: 'uint', v: 0}, {t: 'uint', v: r3start}, {t: 'uint', v:r3end}, {t: 'address', v:accounts[2]}, {t: 'uint', v:i+1}, {t:'bytes32', v:h}, {t:'address', v:pisaInstance.address});
    signature = await web3.eth.sign(receipt3, accounts[4]);
    await truffleAssert.reverts(pisaInstance.recourse(0, r3start, r3end, accounts[2], i+1, h, s, signature, accounts[4], shard, {from:accounts[2]}), "Invalid expiry and starttime");


  });

  it('Recourse should fail as receipt is invalid', async () => {
    var pisaInstance = await PISA.deployed();
    var registryInstance = await DataRegistry.deployed();
    var accounts =  await web3.eth.getAccounts();

    // Current time (latest block)
    var timenow = await getCurrentTime();

    // Set up values for the signed receipt
    let i = 2;
    let s = 12312;
    let h = web3.utils.soliditySha3({t: 'uint', v:s});

    // Dispute time window
    let disputestart = timenow-100;
    let disputeend = timenow-50;
    let shard = await registryInstance.getDataShardIndex.call(disputeend);

    // Receipt 3 times
    let r1start = timenow-101; // BEFORE DISPUTE
    let r1end = timenow-49; // AFTER DISPUTE

    // Dummy receipt
    let receipt1 = web3.utils.soliditySha3({t: 'uint', v: 0}, {t: 'uint', v: r1start}, {t: 'uint', v:r1end}, {t: 'address', v:accounts[2]}, {t: 'uint', v:i}, {t:'bytes32', v:h}, {t:'address', v:pisaInstance.address});
    signature = await web3.eth.sign(receipt1, accounts[4]);

    // Test for invalid pre-image
    await truffleAssert.reverts(pisaInstance.recourse(0, r1start, r1end, accounts[2], i, h, 1337, signature, accounts[4], shard, {from:accounts[2]}), "Secret _s did not match receipt h = H(s)");

    // Test for mismatch between signature and watcher
    // Signed by account[2], trying to blame account[1].
    signature = await web3.eth.sign(receipt1, accounts[2]);
    await truffleAssert.reverts(pisaInstance.recourse(0, r1start, r1end, accounts[2], i+1, h, s, signature, accounts[4], shard, {from:accounts[2]}), "Receipt is not signed by this watcher");

  });


  it('Record command dispute. Recourse should fail then succeed. ', async () => {
      var pisaInstance = await PISA.deployed();
      var registryInstance = await DataRegistry.deployed();
      var accounts =  await web3.eth.getAccounts();

      // Current time (latest block)
      var timenow = await getCurrentTime();

      // Set up values for the signed receipt
      let i = 2;
      let s = 218931289;
      let h = web3.utils.soliditySha3({t: 'uint', v:s});

      // Dispute time window
      let disputestart = timenow-100;
      let disputeend = timenow;

      // Store a dispute
      // Accounts[5] records the dispute. (the state channel)
      let encoded = web3.eth.abi.encodeParameters(['uint','uint','uint'], [disputestart,disputeend,i]);
      let result = await registryInstance.setData(encoded, {from: accounts[5]});
      var block = await web3.eth.getBlock(result['receipt']['blockNumber']);
      let shard = await registryInstance.getDataShardIndex.call(disputeend);

      // Receipt
      let r1start = disputestart-1; // BEFORE DISPUTE
      let r1end = disputeend+1; // AFTER DISPUTE

      // PISA signs receipt
      let receipt = web3.utils.soliditySha3({t: 'uint', v: 1}, {t: 'uint', v: r1start}, {t: 'uint', v:r1end}, {t: 'address', v:accounts[5]}, {t: 'uint', v:i-1}, {t:'bytes32', v:h}, {t:'address', v:pisaInstance.address});
      let signature = await web3.eth.sign(receipt, accounts[4]);

      // Test recourse - PISA should be at fault!
      recourse = await pisaInstance.recourse.call(1,r1start, r1end, accounts[5], i-1, h, s, signature, accounts[4], shard);
      assert.equal(recourse,false,"recourse fails, PISA was not at fault" );

      // PISA signs receipt
      receipt = web3.utils.soliditySha3({t: 'uint', v: 1}, {t: 'uint', v: r1start}, {t: 'uint', v:r1end}, {t: 'address', v:accounts[5]}, {t: 'uint', v:i}, {t:'bytes32', v:h}, {t:'address', v:pisaInstance.address});
      signature = await web3.eth.sign(receipt, accounts[4]);

      // Test recourse - PISA should be at fault!
      recourse = await pisaInstance.recourse.call(1,r1start, r1end, accounts[5], i, h, s, signature, accounts[4], shard);
      assert.equal(recourse,true,"recourse successful, PISA was at fault. PISA had i and command transitioned from i-1" );
    });


});
