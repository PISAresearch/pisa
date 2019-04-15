---
eip: ??
title: Data Registry for Temporary Storage
author:
type: Standards Track
category: ERC
status: Draft
created: 2019-04-11
---

## Abstract

We propose a registry to record arbitrary data for a limited period of time.
The motivation for this EIP is to deploy a central registry to record disputes for off-chain channels.
This on-chain evidence can be used to hold a watching service accountable (alongside a signed receipt) as there is evidence a watching service was hired, burt failed to respond on a customer's behalf.
However a data registry is useful for countless other applications in the Ethereum eco-system.


## Specification

**NOTES**:
 - The following specifications use syntax from Solidity `0.5.0` (or above)


## No signatures
This standard does not require any signatures. It is only concerned with storing data on behalf of smart contracts.

## DataRegistry

The DataRegistry is responsible for maintaining a list of DataShards. Each DataShard is associated with a given day and stores a list of encoded data for a smart contract. A magic number, *TOTAL_DAYS*, will decide the total DataShards maintained by the DataRegistry.
Every *TOTAL_DAYS*, the DataShard is reset by self-destructing and re-creating it. This is a workaround to delete the contents of a mapping.

#### setData

``` js
function setData(bytes memory data) public;
```

Store the encoded data and emit the event:

``` js
emit NewRecord(address sc, bytes[] data, uint datashard)
```

The *datashard* is an identifier for the DataShard. By default it will always be 0 unless the DataRegistry has implemented the DataShard approach to handle data storage.

#### fetchRecords

``` js
function fetchRecords(address _sc, uint _datashard) public returns (bytes[] memory)
```

Fetches the list of data records for a given smart contract. The *_datashard* informs the DataRegistry which DataShard to use when fetching the records.

#### getDataShardIndex

``` js
function getDataShardIndex(uint findShard) public returns (uint8)
```
Given appropriate information, this will return the index for the DataShard. In the [PISA Implementation], the findShard is a UNIX timestamp and it returns within the range 0 to TOTAL_DAYS.

#### getDataShardAddress

``` js
function getDataShardAddress(uint findShard) public returns (address)
```

Given appropriate information, this will return the address for a DataShard. In the [PISA Implementation], the findShard is a UNIX timestamp as each DataShard corresponds to a given day.

## DataShard

Each DataShards corresponds to a list of data records for a given 24 hour period (according to the time of submission).
All functions can only be called by the owner of this contract which is the DataRegistry.

#### setData

``` js
function setData(address sc, bytes memory data) onlyOwner public {
```
DataShard has a mapping to link a contract address to a list of data items. This appends a new data item to the list.


#### fetchData

``` js
function fetchData(address _sc) onlyOwner public view returns(bytes[] memory) {
```
Given a smart contract address, return the list of data items.

#### kill
``` js
function kill() onlyOwner public {
```

This kills the DataShard. It is only callable by the DataRegistry conntract. This is used to let us destroy mapping records.

## Implementation

There is a single implementation by PISA Research Limited.

#### Example implementations are available at
- [PISA  implementation] https://github.com/PISAresearch/pisa/tree/master/dataregistry/contracts


## History

Historical links related to this standard:

- PISA Paper https://www.cs.cornell.edu/~iddo/pisa.pdf


## Copyright
Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
