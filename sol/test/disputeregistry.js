const PISA = artifacts.require("PISA");
const DisputeRegistry = artifacts.require("DisputeRegistry");
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

contract('DisputeRegistry', (accounts) => {
  it('Test Days', async () => {
    var registryInstance = await DisputeRegistry.deployed();
    var accounts =  await web3.eth.getAccounts();

    assert.equal(await registryInstance.getDay.call(1555236000),0, "1st Sunday");
    assert.equal(await registryInstance.getDay.call(1555322400),1, "1st Monday");
    assert.equal(await registryInstance.getDay.call(1555408800),2, "1st Tuesday");
    assert.equal(await registryInstance.getDay.call(1555495200),3, "1st Wednesday");
    assert.equal(await registryInstance.getDay.call(1555581600),4, "1st Thursday");
    assert.equal(await registryInstance.getDay.call(1555668000),5, "1st Friday");
    assert.equal(await registryInstance.getDay.call(1555754400),6, "1st Saturday");
    assert.equal(await registryInstance.getDay.call(1555840800),7, "2nd Sunday");
    assert.equal(await registryInstance.getDay.call(1555927200),8, "2nd Monday");
    assert.equal(await registryInstance.getDay.call(1556013600),9, "2nd Tuesday");
    assert.equal(await registryInstance.getDay.call(1556100000),10, "2nd Wednesday");
    assert.equal(await registryInstance.getDay.call(1556186400),11, "2nd Thursday");
    assert.equal(await registryInstance.getDay.call(1556272800),12, "2nd Friday");
    assert.equal(await registryInstance.getDay.call(1556359200),13, "2nd Saturday");
    assert.equal(await registryInstance.getDay.call(1556445600),0, "Full loop");

  });

  it('Set and test command dispute', async () => {
    var registryInstance = await DisputeRegistry.deployed();
    var accounts =  await web3.eth.getAccounts();

    // Current time (latest block)
    let timenow = await getCurrentTime();

    // Dispute time window
    let disputestart = timenow-100;

    // version
    let i = 20;

    // Store a dispute
    let result = await registryInstance.setDispute(disputestart, i, {from: accounts[2]});
    let block = await web3.eth.getBlock(result['receipt']['blockNumber']);
    let disputeend = block['timestamp'];

    let res = await registryInstance.testDispute.call(1, accounts[2], disputestart, disputeend, i);
    assert.equal(res,true,"PISA has i=20, state transitioned to 20 from 19. Pisa could have responded");

    res = await registryInstance.testDispute.call(1, accounts[2], disputestart, disputeend, i-1);
    assert.equal(res,false,"PISA has i=19, state transitioned to 20 from 19. Pisa could have responded");

    res = await registryInstance.testDispute.call(1, accounts[2], disputestart, disputeend, i+1);
    assert.equal(res,true,"PISA has i=21, state transitioned to 20 from 19. Pisa could have responded");
  });


  it('Set and test closure dispute', async () => {
    var registryInstance = await DisputeRegistry.deployed();
    var accounts =  await web3.eth.getAccounts();

    // Current time (latest block)
    let timenow = await getCurrentTime();

    // Dispute time window
    let disputestart = timenow-100;

    // version
    let i = 20;

    // Store a dispute
    let result = await registryInstance.setDispute(disputestart, i, {from: accounts[7]});
    let block = await web3.eth.getBlock(result['receipt']['blockNumber']);
    let disputeend = block['timestamp'];

    let res = await registryInstance.testDispute.call(0, accounts[7], disputestart, disputeend, i);
    assert.equal(res,false,"PISA has i=20, State concluded on 20. PISA may have responded, all good. ");

    res = await registryInstance.testDispute.call(0, accounts[7], disputestart, disputeend, i-1);
    assert.equal(res,false,"PISA has i=19, State concluded on 20. PISA didn't need to respond.");

    res = await registryInstance.testDispute.call(0, accounts[7], disputestart, disputeend, i+1);
    assert.equal(res,true,"PISA has i=21, State concluded on 20. PISA should have responded, bad. ");
  });

  it('Test killing and re-creating a daily record', async () => {
    var registryInstance = await DisputeRegistry.deployed();
    var accounts =  await web3.eth.getAccounts();

    var TOTAL_DAYS = await registryInstance.getTotalDays.call();
    var previousweek = new Array();

    for(let j=0; j<TOTAL_DAYS; j++) {
      previousweek[j] = '123123912391';
    }

    // Lets try for some many weeks
    for(let i=0; i<4; i++) {

      // Go through each day and create a new daily record!
      // We'll compare it with the address we fgot the previous week.
      for(let k=0; k<TOTAL_DAYS; k++) {

        var oldtimestamp = await getCurrentTime();
        let result = await registryInstance.setDispute(oldtimestamp, 99, {from: accounts[9]});
        let day =  await registryInstance.getDay.call(oldtimestamp);
        let addr = await registryInstance.getDailyRecordAddress.call(oldtimestamp);
        result = await registryInstance.setDispute(oldtimestamp, 200, {from: accounts[6]});
        let sameday =  await registryInstance.getDay.call(oldtimestamp);
        let sameaddr = await registryInstance.getDailyRecordAddress.call(oldtimestamp);
        assert.equal(day.toNumber(),sameday.toNumber(), "Both days should be the same!");
        assert.equal(addr,sameaddr, "DailyRecord address should not change. Disputes on same day. ");
        assert.notEqual(previousweek[k],addr, "Daily record contract should have a new address compared to previous week");

        // Move to next day!
        oldtimestamp = await getCurrentTime();
        newBlock = await advanceTimeAndBlock(86400);
        newtimestamp = newBlock['timestamp'];
        timeDiff = newtimestamp - oldtimestamp;

        // Did it work ok?
        assert.isTrue(timeDiff >= 86400);
        previousweek[k] = addr; // keep for next round
      }

      // // Store a dispute
      // var oldtimestamp = await getCurrentTime();
      // result = await registryInstance.setDispute(oldtimestamp-10, 99, {from: accounts[9]});
      // let day =  await registryInstance.getDay.call(oldtimestamp);
      // let addr = await registryInstance.getDailyRecordAddress.call(oldtimestamp);
      // result = await registryInstance.setDispute(oldtimestamp-50, 200, {from: accounts[6]});
      // let sameday =  await registryInstance.getDay.call(oldtimestamp);
      // let sameaddr = await registryInstance.getDailyRecordAddress.call(oldtimestamp);
      // assert.equal(day.toNumber(),sameday.toNumber(), "Both days should be the same!");
      // assert.equal(addr,sameaddr, "DailyRecord address should not change. Disputes on same day. ");
      //
      // // Grab timestamps for old and future block.
      // oldtimestamp = await getCurrentTime();
      // let newBlock = await advanceTimeAndBlock(86400 * 14);
      // var newtimestamp = newBlock['timestamp'];
      // let timeDiff = newtimestamp - oldtimestamp;
      //
      // // Did it work ok?
      // assert.isTrue(timeDiff >= 86400 * 14);
      //
      // // Set new dispute (this should kill old dailyrecord and create new dailyrecord)
      // result = await registryInstance.setDispute(newtimestamp-50, 50, {from: accounts[2]});
      //
      // // Get the address for today's daily record
      // let day2 =  await registryInstance.getDay.call(newtimestamp);
      // let addr2 = await registryInstance.getDailyRecordAddress.call(newtimestamp);
      //
      // // Make sure we are looking at the daily same / daily record
      // assert.equal(day.toNumber(),day2.toNumber(), "Both days should be the same!");
      //
      // // Daily Record have a new address!
      // console.log(day2.toNumber());
      // assert.notEqual(addr,addr2, "Daily record contract should have a new address");
      //
      // // MOVE FORWARD BY 1 DAY AND REPEAT PROCESS!
      // // WE WILL TEST ALL FOURTEEN DAYS!
      // oldtimestamp = await getCurrentTime();
      // newBlock = await advanceTimeAndBlock(86400);
      // newtimestamp = newBlock['timestamp'];
      // timeDiff = newtimestamp - oldtimestamp;
      //
      // // Did it work ok?
      // assert.isTrue(timeDiff >= 86400);
    }
  });




});