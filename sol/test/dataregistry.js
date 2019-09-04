// const DataRegistry = artifacts.require("DataRegistry");
// const assert = require("chai").assert;
// const truffleAssert = require('truffle-assertions');
//
// web3.providers.HttpProvider.prototype.sendAsync = web3.providers.HttpProvider.prototype.send;
//
// advanceTimeAndBlock = async (time) => {
//     await advanceTime(time);
//     await advanceBlock();
//
//     return Promise.resolve(web3.eth.getBlock('latest'));
// }
//
// advanceTime = (time) => {
//     return new Promise((resolve, reject) => {
//         web3.currentProvider.sendAsync({
//             jsonrpc: "2.0",
//             method: "evm_increaseTime",
//             params: [time],
//             id: new Date().getTime()
//         }, (err, result) => {
//             if (err) { return reject(err); }
//             return resolve(result);
//         });
//     });
// }
//
// advanceBlock = () => {
//     return new Promise((resolve, reject) => {
//         web3.currentProvider.sendAsync({
//             jsonrpc: "2.0",
//             method: "evm_mine",
//             id: new Date().getTime()
//         }, (err, result) => {
//             if (err) { return reject(err); }
//             const newBlockHash = web3.eth.getBlock('latest').hash;
//
//             return resolve(newBlockHash)
//         });
//     });
// }
//
// module.exports = {
//     advanceTime,
//     advanceBlock,
//     advanceTimeAndBlock
// }
//
//
// function timeout(ms) {
//         return new Promise(resolve => setTimeout(resolve, ms));
//     }
//
// contract('DataRegistry', (accounts) => {
//   it('Test Days', async () => {
//     var registryInstance = await DataRegistry.deployed();
//     var accounts =  await web3.eth.getAccounts();
//
//     var interval = await registryInstance.getInterval.call();
//     assert.equal(await registryInstance.getDataShardIndex.call(0),0, "Shard 0");
//     assert.equal(await registryInstance.getDataShardIndex.call(1 * interval.toNumber()),1, "Shard 1");
//     assert.equal(await registryInstance.getDataShardIndex.call(2 * interval.toNumber()),0, "Shard 0");
//     assert.equal(await registryInstance.getDataShardIndex.call(3 * interval.toNumber()),1, "Shard 1");
//     assert.equal(await registryInstance.getDataShardIndex.call(4 * interval.toNumber()),0, "Shard 0");
//     assert.equal(await registryInstance.getDataShardIndex.call(5 * interval.toNumber()),1, "Shard 1");
//
//   });
//
//   it('Set record', async () => {
//     var registryInstance = await DataRegistry.deployed();
//     var accounts =  await web3.eth.getAccounts();
//
//     // Current time (latest block)
//     let blockNo = await web3.eth.getBlockNumber();
//
//     // Store a dispute
//     let encoded = web3.eth.abi.encodeParameters(['uint','uint','uint'], [1,2,3]);
//
//     // Store the data
//     await registryInstance.setRecord("0x123", encoded, {from: accounts[7]});
//     let shard = await registryInstance.getDataShardIndex.call(blockNo);
//     let data = await registryInstance.fetchRecord.call(shard, accounts[7], "0x123", 0);
//     assert.equal(encoded,data, "Encoded data should be stored in the data registry");
//
//     // Confirm there is no "out of bound" exception thrown
//     data = await registryInstance.fetchRecord.call(shard, accounts[7], "0x123", 2);
//     assert.notEqual(encoded,data, "No data should be stored!");
//   });
//
//   it('Set records', async () => {
//     var registryInstance = await DataRegistry.deployed();
//     var accounts =  await web3.eth.getAccounts();
//
//     // Current time (latest block)
//     let blockNo = await web3.eth.getBlockNumber();
//
//     // Store a dispute
//     let encoded0 = web3.eth.abi.encodeParameters(['uint','uint','uint'], [9123,123,1328]);
//     let encoded1 = web3.eth.abi.encodeParameters(['uint','uint'], [6787891,1231232]);
//
//     // Store the data
//     await registryInstance.setRecord("0x123", encoded0, {from: accounts[6]});
//     await registryInstance.setRecord("0x123", encoded1, {from: accounts[6]});
//     let shard = await registryInstance.getDataShardIndex.call(blockNo);
//     let data = await registryInstance.fetchRecords.call(shard, accounts[6], "0x123");
//
//     // Check the fetch was successful and then check what we fetched
//     assert.equal(encoded0,data[0]);
//     assert.equal(encoded1,data[1]);
//     assert.notEqual(encoded1, data[0]);
//
//     // No records should exist. So return should be false.
//     data = await registryInstance.fetchRecords.call(shard, accounts[5], "0x123");
//     assert.equal(data.length, 0);
//   });
//
//   it('Set hash', async () => {
//     var registryInstance = await DataRegistry.deployed();
//     var accounts =  await web3.eth.getAccounts();
//
//     // Current time (latest block)
//     let blockNo = await web3.eth.getBlockNumber();
//
//     // Store a dispute
//     let encoded = web3.eth.abi.encodeParameters(['uint','uint','uint'], [3,2,1]);
//     let hash =  web3.utils.keccak256(encoded);
//
//     // Store the data
//     await registryInstance.setHash("0x111111", encoded, {from: accounts[7]});
//     let shard = await registryInstance.getDataShardIndex.call(blockNo);
//     let h = await registryInstance.fetchHash.call(shard, accounts[7], "0x111111", 0);
//     assert.equal(h, hash, "Hash should be stored in the data registry");
//
//     // Confirm there is no "out of bound" exception thrown
//     h = await registryInstance.fetchHash.call(shard, accounts[7], "0x111111", 2);
//     assert.notEqual(hash,h, "No hash should be stored!");
//   });
//
//   it('Set hashes', async () => {
//     var registryInstance = await DataRegistry.deployed();
//     var accounts =  await web3.eth.getAccounts();
//
//     // Current time (latest block)
//     let blockNo = await web3.eth.getBlockNumber();
//
//     // Store a dispute
//     let encoded0 = web3.eth.abi.encodeParameters(['uint','uint','uint'], [312809,312789,903812]);
//     let encoded1 = web3.eth.abi.encodeParameters(['uint','uint'], [42373248,1917239]);
//
//     // Store the data
//     await registryInstance.setHash("0x999", encoded0, {from: accounts[6]});
//     await registryInstance.setHash("0x999", encoded1, {from: accounts[6]});
//     let shard = await registryInstance.getDataShardIndex.call(blockNo);
//     let data = await registryInstance.fetchHashes.call(shard, accounts[6], "0x999");
//
//     // Check the fetch was successful and then check what we fetched
//     assert.equal(web3.utils.keccak256(encoded0),data[0]);
//     assert.equal(web3.utils.keccak256(encoded1),data[1]);
//     assert.notEqual(web3.utils.keccak256(encoded1), data[0]);
//
//     // No records should exist. So return should be false.
//     data = await registryInstance.fetchRecords.call(shard, accounts[5], "0x999");
//     assert.equal(data.length, 0);
//   });
//
//   it('Test killing and re-creating shards', async () => {
//     var registryInstance = await DataRegistry.deployed();
//     var accounts =  await web3.eth.getAccounts();
//
//     var TOTAL_SHARDS = await registryInstance.getTotalShards.call();
//     var prevAddr = '12321312213';
//     // Lets try for some many weeks
//     for(let i=0; i<2; i++) {
//
//       // Go through each day and create a new daily record!
//       // We'll compare it with the address we fgot the previous week.
//       for(let k=0; k<TOTAL_SHARDS; k++) {
//
//         var oldtimestamp = await web3.eth.getBlockNumber();
//         var interval = await registryInstance.getInterval.call();
//         let encoded = web3.eth.abi.encodeParameters(['uint','uint','uint'], [oldtimestamp,oldtimestamp+20,3]);
//         let encoded2 = web3.eth.abi.encodeParameters(['uint','uint','uint'], [oldtimestamp-10,oldtimestamp+10,5]);
//
//         // Store encoded data from an account
//         let result = await registryInstance.setRecord("0x123", encoded, {from: accounts[9]});
//         let datashard =  await registryInstance.getDataShardIndex.call(oldtimestamp);
//         let addr = await registryInstance.getDataShardAddress.call(oldtimestamp);
//
//         // Store different encoded data from another account
//         result = await registryInstance.setRecord("0x123", encoded2, {from: accounts[6]});
//         let samedatashard =  await registryInstance.getDataShardIndex.call(oldtimestamp);
//         let sameaddr = await registryInstance.getDataShardAddress.call(oldtimestamp);
//
//         assert.equal(datashard.toNumber(),samedatashard.toNumber(), "Both days should be the same!");
//         assert.equal(addr,sameaddr, "DataShard address should not change. Disputes on same day. ");
//         assert.notEqual(prevAddr,addr, "Daily record contract should have a new address");
//
//         // Move to next day!
//         oldtimestamp = await web3.eth.getBlockNumber();
//
//         for(let i=0; i<interval.toNumber(); i++) {
//           await advanceBlock();
//         }
//         prevAddr = addr; // keep for next round
//       }
//     }
//   });
//
//
//
//
// });
