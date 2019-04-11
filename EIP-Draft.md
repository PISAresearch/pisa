---
eip: ??
title: Off-chain Dispute Registry for Replace by Version
author: 
type: Standards Track
category: ERC
status: Draft
created: 2019-04-11
---

## Abstract

We propose a registry to record successful disputes for off-chain state channels. This EIP is only concerned with replace by version channels as this is the unofficial standard used by most products. The motivation for recording disputes is to ensure third party watching services (PISA) can be held accountable if there is evidence a watching service was hired, but failed to respond on a customer's behalf.  

The following standard allows for the implementation of a registry within a smart contract. It will provide guidance to teams developing off-chain channels on how their dispute should be recorded in the registry. 


## Specification

**NOTES**:
 - The following specifications use syntax from Solidity `0.5.0` (or above)
 
 
## No signatures
This standard does not require any signatures. It is only concerned with recording and testing disputes. 

A future EIP can extend this standard and cover how the watching service contract works. 

## Appointment Receipt 

``` js
uint channelmode // How to a test dispute
address sc // State channel address 
uint starttime // When dispute was triggered. UNIX timestamp or block number. 
uint expiry // When dispute expires. UNIX timestamp or block numner. 
uint version // State version a watching service agreed to broadcast. 
```

Two types of channel modes supported by default: 

 - *Closure dispute.* Confirms an agreed off-chain state.
 - *Command dispute.* Performs a state transition via the dispute process. 
 
We record information about the dispute: 
 - *Start time.* When the dispute was triggered on-chain.
 - *Expiry time.* When the dispute expires on-chain. (NOT settlement time). 
 - *Version.* Final recorded version 
 
All disputes are recorded per day and the dispute registry will keep the record for a fixed time period (TOTAL_DAYS). 

## DisputeRegistryInterface
 
#### testReceipt

Given a receipt, it returns:

- TRUE if the watching service could have, but did not respond to a dispute. 
- FALSE if the watching service is not at fault. 

``` js
function testReceipt(uint _channelmode, address _sc, uint _starttime, uint _expiry, uint _version, uint _datashard) public returns (bool)
```

This standard interface includes *datashard*. It informs the registry where to fetch the dispute record. This minimises the need to search for the record via on-chain execution. 


## DisputeRegistry

The Registry is responsible for maintaining a list of disputes for each channel. 

- Given a new dispute, it will store the dispute. 
- Given a receipt, it will fetch the respective dispute and return the result to the caller. 

#### setDispute

``` js
function setDispute(uint _starttime, uint _expiry, uint _version) public; 
```

Store a dispute and emit the event: 

``` js
emit NewRecord(msg.sender, _starttime, _expiry, _stateround, _datashard)
```

As mentioned previouly, *datashard* is the location to find the dispute record in the Dispute Registry. By default, this will always be 0 unless the DisputeRegistry has an internal mechanism to handle data storage.

#### testReceipt

``` js
function testReceipt(uint _channelmode, address _sc, uint _starttime, uint _endtime, uint _version, uint day) public returns (bool)
```

An implementation of the DisputeRegistry.testReceipt() interface. 

Given a receipt, this will test:

 - *Closure Dispute.* When _channelmode = 0: 
    - If a watching service broadcasts version i, the dispute will settle based on version i (or greater).
 - *Command Dispute.* When _channelmode = 1.  
    - If a watching service broadcasts version i, the dispute will settle based on version i+1 (or greater).

[In the PISA implemention, this test logic is pushed to DailyRecord to minimise gas consumption and avoid returning a list of structs]

## DailyRecord

How this EIP standard implements data sharding for dispute records. 

#### How DailyRecord integrates the Dispute Registry

The registry is responsible for managing a list of DailyRecords. 

Each DailyRecord corresponds to a list of dispute records for a given day (according to the day of dispute submission). 

The tracker *datashard* ranges from 0 to TOTAL_DAYS. 

TOTAL_DAYS is a magic number that specifies the maximum number of DailyRecords. 

When a DailyRecord is reached (day %% TOTAL_DAYS), the registry will selfdestruct and re-create the DailyRecord contract. This wipes the mapping and all dispute records for that day. This selfdestruct appraoch is a workaround to support deleting a mapping. 

#### setDispute

``` js
function setDispute(uint _starttime, uint _expiry, uint _version, address _sc) onlyOwner public {
```

DailyRecord has a mapping that links the state channel address to a list of disputes. This will append a new dispute to the list. 

*OnlyOwner* only permits disputes to be stored by the DisputeRegsitry. 


#### testReceipt

``` js
function testReceipt(uint _channelmode, address _sc, _uint _starttime, uint _expiry, uint _version) onlyOwner public {
```

*OnlyOwner* only permits tests to be conducted by the DisputeRegistry.

[In the PISA implementation, we perform the test of records here to simplify the implementation]

## Implementation

There is a single implementation by PISA Research Limited. 

#### Example implementations are available at
- [PISA  implementation] https://github.com/PISAresearch/pisa/tree/master/sol/contracts


## History

Historical links related to this standard:

- PISA Paper https://www.cs.cornell.edu/~iddo/pisa.pdf


## Copyright
Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
