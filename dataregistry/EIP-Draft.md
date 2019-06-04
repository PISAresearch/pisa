---
eip: ??
title: Temporary Data Persistence via a Data Registry
author:
type: Standards Track
category: ERC
status: Draft
created: 2019-06-03
---

## Abstract

We propose a registry to store data for a limited period of time. 
The motivation is to guarantee temporary data persistence such that the sender can disappear (or self-destruct) after storing the data. 
In the short-term, the data registry is useful for recording on-chain disputes for off-chain channels. Given a signed receipt and the dispute records, the client can use this evidence to prove a third party watching service has cheated and thus hold them financially accountable. 
In the future, the data registry is useful for any application in the Ethereum eco-system when a client may wish to hire an accountable third party watching service to respond to on-chain events on their behalf. 


## Specification

**NOTES**:
 - The following specifications use syntax from Solidity `0.5.0` (or above)


## No signatures
This standard does not require any signatures. It is only concerned with storing data on behalf of smart contracts.

## DataRegistry

The DataRegistry is responsible for maintaining a list of DataShards. Each DataShard is responsible for storing a list of encoded bytes for a given smart contract. All DataShards have the same life-span (i.e. 1 day, 2 weeks, etc). It is eventually reset by self-destructing and re-creating the data shard's smart contract after its life-span. 

#### Total Data Shards 

``` js
uint constant INTERVAL;
uint constant TOTAL_SHARDS;
```

Every DataShard has a life-span of *INTERVAL* and there is a total of *TOTAL_SHARDS* in the smart contract. After each interval, the next data shard can be created by the data registry. When we re-visit an existing shard, the data registry will destory and re-create it. This is mostly a workaround to delete the contents of a mapping.

#### Uniquely identifying stored data 

All data is stored according to the format: 

``` js
uint _datashard, address _sc, uint _id, uint _index; 
```

A brief overview: `

* **_datashard** - Which DataShard is the data stored in.

* **_sc** - Sender's address that stored data in the registry. 

* **_id** - An identifier for storing data in the registry. 

* **_index** - *[optional]* All data is stored as *bytes[]*. The *_index* lets us look up one element in the list. If *_index* is not supplied, then the entire array is returned. 

#### Computing the unique identifier for a data record 

How the smart contract computes *_id*  is application-specific. For off-chain protocols, we'll propose a future EIP (or SCIP) to standardise the process. 

#### setData

``` js
function setData(uint _id, bytes memory _data) public;
```

Store the encoded data and emits the event:

``` js
emit NewRecord(uint datashard, address sc, uint id, uint index, bytes data)
```
As mentioned previously, the data recorded is listed according to *msg_sender* and the data is appended to corresponding list. 

#### fetchRecords

``` js
function fetchRecords(uint _datashard, address _sc, uint _id) public returns (bytes[] memory)
```

Fetches the list of data records for a given smart contract. The *_datashard* informs the DataRegistry which DataShard to use when fetching the records.

``` js
function fetchRecord(uint _datashard, address _sc, uint _id, uint _index) public returns (bytes memory)
```

Returns a single data record according to the index. Note the smart contract will return an empty record if the *_index* is out of bounds. It will NOT throw an exception and revert the transaction. 

#### getDataShardIndex

``` js
function getDataShardIndex(uint _timestamp) public returns (uint8)
```
Given a timestamp, it will return the index for a data shard. This ranges from 0 to TOTAL_DAYS. 

#### getDataShardAddress

``` js
function getDataShardAddress(uint _timestamp) public returns (address)
```

Given a timestamp information, this will return the address for a DataShard. 

## DataShard

Each DataShard has a minimum life-span and it stores a list of data records. All functions can ONLY be executed by the owner of this contract - which should be the DataRegistry. 


#### Storing data 

``` js
function setData(address sc, uint _id, bytes memory _data) onlyOwner public {
```


DataShard has a mapping to link a contract address to a list of data items. This appends a new data item to the list.


#### Fetch Data 

``` js
function fetchItem(address _sc, uint _id, uint _index) onlyOwner public view returns(bytes memory) {
```
Given a smart contract address, returns a single data item at index *_index*. If the request is out-of-bounds, it just returns an empty bytes. 

``` js
function fetchList(address _sc, uint _id) onlyOwner public view returns(bytes[] memory) {
```
Returns the entire list *bytes[]* for the smart contract and the respective ID. 

#### kill
``` js
function kill() onlyOwner public {
```

This kills the DataShard. It is only callable by the DataRegistry contract. This is used to let us destroy mapping records.

## Implementation

There is a single implementation by PISA Research Limited.

#### Example implementation of DataRegistry and an example contract 
- [Data Registry] https://github.com/PISAresearch/pisa/blob/master/dataregistry/contracts/DataRegistry.sol
- [Challenge Contract] https://github.com/PISAresearch/pisa/blob/master/DataRegistry/contracts/ChallengeCommandContract.sol


## History

Historical links related to this standard:

- PISA Paper https://www.cs.cornell.edu/~iddo/pisa.pdf


## Copyright
Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
