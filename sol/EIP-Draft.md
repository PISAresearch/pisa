---
eip: ??
title: Temporary Log Registry
author:
type: Standards Track
category: ERC
status: Draft
created: 2019-04-11
---

## Abstract

We propose a registry to record logs for a limited period of time.
We envision the log registry is useful for recording disputes in off-chain channels to hold third party watching services accountable.
However in the future a log registry is useful for any application in the Ethereum eco-system that may wish to hire a third party watching service to respond to an on-chain event on behalf of the user.


## Specification

**NOTES**:
 - The following specifications use syntax from Solidity `0.5.0` (or above)


## No signatures
This standard does not require any signatures. It is only concerned with storing logs on behalf of smart contracts.

## LogRegistry

The LogRegistry is responsible for maintaining a list of DataShards. Each DataShard is associated with a given day and stores a list of encoded data for a smart contract. A magic number, *TOTAL_DAYS*, will decide the total DataShards maintained by the LogRegistry.
Every *TOTAL_DAYS*, the DataShard is reset by self-destructing and re-creating it. This is a workaround to delete the contents of a mapping.

#### setData

``` js
function setData(bytes memory _data) public;
```

Store the encoded data and emit the event:

``` js
emit NewRecord(address sc, bytes[] data, uint datashard)
```

The *datashard* is an identifier for the DataShard. By default it will always be 0 unless the LogRegistry has implemented the DataShard approach to handle data storage.

#### fetchRecords

``` js
function fetchRecords(address _sc, uint _datashard) public returns (bytes[] memory)
```

Fetches the list of data records for a given smart contract. The *_datashard* informs the LogRegistry which DataShard to use when fetching the records.

``` js
function fetchRecords(address _sc, uint _datashard, uint _i) public returns (bytes[] memory)
```

Fetches a single data record at index *_i* for a given smart contract. The *_datashard* informs the LogRegistry which DataShard to use when fetching the single record

#### getDataShardIndex

``` js
function getDataShardIndex(uint _findShard) public returns (uint8)
```
Given appropriate information, this will return the index for the DataShard. In the [PISA Implementation], the findShard is a UNIX timestamp and it returns within the range 0 to TOTAL_DAYS.

#### getDataShardAddress

``` js
function getDataShardAddress(uint _findShard) public returns (address)
```

Given appropriate information, this will return the address for a DataShard. In the [PISA Implementation], the findShard is a UNIX timestamp as each DataShard corresponds to a given day.

## DataShard

Each DataShards corresponds to a list of data records for a given 24 hour period (according to the time of submission).
All functions can only be called by the owner of this contract which is the LogRegistry.

#### setData

``` js
function setData(address sc, bytes memory _data) onlyOwner public {
```
DataShard has a mapping to link a contract address to a list of data items. This appends a new data item to the list.


#### fetchData

``` js
function fetchData(address _sc, uint _i) onlyOwner public view returns(bytes[] memory) {
```
Given a smart contract address, return the data item at indexed *_i*.

 js
function fetchData(address _sc) onlyOwner public view returns(bytes[] memory) {
```

#### kill
``` js
function kill() onlyOwner public {
```

This kills the DataShard. It is only callable by the LogRegistry conntract. This is used to let us destroy mapping records.

## Implementation

There is a single implementation by PISA Research Limited.

#### Example implementations are available at
- [PISA  implementation] https://github.com/PISAresearch/pisa/tree/master/LogRegistry/contracts


## History

Historical links related to this standard:

- PISA Paper https://www.cs.cornell.edu/~iddo/pisa.pdf


## Copyright
Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
