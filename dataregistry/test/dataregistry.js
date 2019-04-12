const DataRegistry = artifacts.require("DataRegistry");
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

contract('DataRegistry', (accounts) => {
  it('Test Days', async () => {
    var registryInstance = await DataRegistry.deployed();
    var accounts =  await web3.eth.getAccounts();

    assert.equal(await registryInstance.getDataShardIndex.call(1555236000),0, "1st Sunday");
    assert.equal(await registryInstance.getDataShardIndex.call(1555322400),1, "1st Monday");
    assert.equal(await registryInstance.getDataShardIndex.call(1555408800),2, "1st Tuesday");
    assert.equal(await registryInstance.getDataShardIndex.call(1555495200),3, "1st Wednesday");
    assert.equal(await registryInstance.getDataShardIndex.call(1555581600),4, "1st Thursday");
    assert.equal(await registryInstance.getDataShardIndex.call(1555668000),5, "1st Friday");
    assert.equal(await registryInstance.getDataShardIndex.call(1555754400),6, "1st Saturday");
    assert.equal(await registryInstance.getDataShardIndex.call(1555840800),7, "2nd Sunday");
    assert.equal(await registryInstance.getDataShardIndex.call(1555927200),8, "2nd Monday");
    assert.equal(await registryInstance.getDataShardIndex.call(1556013600),9, "2nd Tuesday");
    assert.equal(await registryInstance.getDataShardIndex.call(1556100000),10, "2nd Wednesday");
    assert.equal(await registryInstance.getDataShardIndex.call(1556186400),11, "2nd Thursday");
    assert.equal(await registryInstance.getDataShardIndex.call(1556272800),12, "2nd Friday");
    assert.equal(await registryInstance.getDataShardIndex.call(1556359200),13, "2nd Saturday");
    assert.equal(await registryInstance.getDataShardIndex.call(1556445600),0, "Full loop");

  });

  it('Set data', async () => {
    var registryInstance = await DataRegistry.deployed();
    var accounts =  await web3.eth.getAccounts();

    // Current time (latest block)
    let timenow = await getCurrentTime();

    // Store a dispute
    let encoded = web3.eth.abi.encodeParameters(['uint','uint','uint'], [1,2,3]);

    let result = await registryInstance.setData(encoded, {from: accounts[7]});
    let shard = await registryInstance.getDataShardIndex.call(timenow);

    let data = await registryInstance.fetchRecords.call(accounts[7], shard);

    assert.equal(encoded,data);
  });

  it('Test killing and re-creating a daily record', async () => {
    var registryInstance = await DataRegistry.deployed();
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
        let encoded = web3.eth.abi.encodeParameters(['uint','uint','uint'], [oldtimestamp,oldtimestamp+20,3]);
        let encoded2 = web3.eth.abi.encodeParameters(['uint','uint','uint'], [oldtimestamp-10,oldtimestamp+10,5]);

        // Store encoded data from an account
        let result = await registryInstance.setData(encoded, {from: accounts[9]});
        let datashard =  await registryInstance.getDataShardIndex.call(oldtimestamp);
        let addr = await registryInstance.getDataShardAddress.call(oldtimestamp);

        // Store different encoded data from another account
        result = await registryInstance.setData(encoded2, {from: accounts[6]});
        let samedatashard =  await registryInstance.getDataShardIndex.call(oldtimestamp);
        let sameaddr = await registryInstance.getDataShardAddress.call(oldtimestamp);

        assert.equal(datashard.toNumber(),samedatashard.toNumber(), "Both days should be the same!");
        assert.equal(addr,sameaddr, "DataShard address should not change. Disputes on same day. ");
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
    }
  });




});
