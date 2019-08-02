[![CircleCI](https://circleci.com/gh/PISAresearch/pisa.svg?style=shield)](https://circleci.com/gh/PISAresearch/pisa)
[![codecov](https://codecov.io/gh/PISAresearch/pisa/branch/master/graph/badge.svg)](https://codecov.io/gh/PISAresearch/pisa)


# PISA - An Accountable Watching Service

PISA is a solution to help alleviate the online requirement for smart contracts.

It was first devised for off-chain protocols, where PISA could be hired to watch for challenges on behalf of its customer. However, in a very generic sense, PISA can be hired to watch any smart contract when a user must respond within a fixed time period to an on-chain event. 

Our infrastructure focuses on supporting several smart contracts including off-chain channels, plasma, auctions, e-voting, makerdao, etc. 

We are working to minimise all integration effort - in the best case a smart contract may just need to post "logs" to a data registry - and we'll take care of the rest! 


## PISA to the rescue - fixing the bad UX for 2 step protocols


As a protocol designer, we love building protocols using commit and reveal to guarantee fairness. Good examples include auctions (seal bid, reveal bid), games (submit sealed choice, reveal choice), and e-voting (submit sealed vote, reveal vote). But so far, the UX around two-step protocols are really bad and users have lost money.

**Why is commit and reveal a bad user experience?** Generally, a commit and reveal protocols requires the user to be online "twice": 

* Users "commit" to their choice (all users must commit before time t1)
* Users "reveal" their choice (all users must reveal before time t2) 

Requiring users *to be online within both time periods* does not translate well to a good user experience in the real world - people can very easily just forget to respond. The big issue is not that they forget and lose-out, but the smart contract will actually slash the customer and make them lose their deposit. Not a great UX outcome, but a necessary evil in smart contract design. 


## How is PISA "Accountable"? 

When PISA is hired by the customer, we provide the custoer with a signed receipt that proves we accepted the job. If we fail to respond on their behalf, then the customer can use on-chain evidence (via the DataRegistry) and the signed receipt as indisputable evidence of our wrongdoing. 

**Two outcomes for the customer if PISA fails** Either the customer is refunded within a fixed time period (based on what we promised in advance) or eventually the customer can slash our security deposit. 

We always have an opportunity to make right our mistake and refund the customer - but ultimately we are financially accountable for the mistake. Thus the customer does NOT have to blindly trust us! 

## When can I start using PISA? 

We are currently working on the implementation and a set of standards to minimise integration efforts with us. If you want to partner with us such that your customers can hire PISA to respond on their behalf - please contact us at paddy@pisa.watch and check out the following standards (we will update this list as more are posted):

* Data Registry (log events) - https://github.com/ethereum/EIPs/pull/2095 
* Example of contract logging events (super simple) - https://github.com/PISAresearch/pisa/blob/master/sol/contracts/ChallengeClosureContract.sol 


# API Documentation

The api exposes a single POST endpoint at /appointment. The request body takes the following format:

# Appointment request schema Schema

```
http://pisa.watch/schemas/appointment-request.json
```

| Abstract            | Extensible | Status       | Identifiable | Custom Properties | Additional Properties | Defined In |
| ------------------- | ---------- | ------------ | ------------ | ----------------- | --------------------- | ---------- |
| Can be instantiated | No         | Experimental | No           | Forbidden         | Forbidden             |            |

# Appointment request schema Properties

| Property                            | Type      | Required     | Nullable | Defined by                               |
| ----------------------------------- | --------- | ------------ | -------- | ---------------------------------------- |
| [challengePeriod](#challengeperiod) | `integer` | **Required** | No       | Appointment request schema (this schema) |
| [contractAddress](#contractaddress) | `string`  | **Required** | No       | Appointment request schema (this schema) |
| [customerAddress](#customeraddress) | `string`  | **Required** | No       | Appointment request schema (this schema) |
| [data](#data)                       | `string`  | **Required** | No       | Appointment request schema (this schema) |
| [endBlock](#endblock)               | `integer` | **Required** | No       | Appointment request schema (this schema) |
| [eventABI](#eventabi)               | `string`  | **Required** | No       | Appointment request schema (this schema) |
| [eventArgs](#eventargs)             | `string`  | **Required** | No       | Appointment request schema (this schema) |
| [gasLimit](#gaslimit)               | `string`  | **Required** | No       | Appointment request schema (this schema) |
| [id](#id)                           | `number`  | **Required** | No       | Appointment request schema (this schema) |
| [jobId](#jobid)                     | `integer` | **Required** | No       | Appointment request schema (this schema) |
| [mode](#mode)                       | `integer` | **Required** | No       | Appointment request schema (this schema) |
| [paymentHash](#paymenthash)         | `string`  | **Required** | No       | Appointment request schema (this schema) |
| [postCondition](#postcondition)     | `string`  | **Required** | No       | Appointment request schema (this schema) |
| [refund](#refund)                   | `string`  | **Required** | No       | Appointment request schema (this schema) |
| [startBlock](#startblock)           | `integer` | **Required** | No       | Appointment request schema (this schema) |

## challengePeriod

### Challenge period

The number of blocks that PISA has to respond if an event is noticed

`challengePeriod`

- is **required**
- type: `integer`
- defined in this schema

### challengePeriod Type

`integer`

- minimum value: `0`
- maximum value: `9007199254740991`

### challengePeriod Example

```json
100
```

## contractAddress

### Contract address

The address of the external contract to which the data will be submitted

`contractAddress`

- is **required**
- type: `string`
- defined in this schema

### contractAddress Type

`string`

### contractAddress Example

```json
"0x81b7e08f65bdf5648606c89998a9cc8164397647"
```

## customerAddress

### Customer address

The address of the customer hiring PISA

`customerAddress`

- is **required**
- type: `string`
- defined in this schema

### customerAddress Type

`string`

### customerAddress Example

```json
"0x9e64b53b935602cd0657343C69Fe200fb3cD05c8"
```

## data

### Data

The data to be submitted to the external contract

`data`

- is **required**
- type: `string`
- defined in this schema

### data Type

`string`

### data Example

```json
"0x28fbdf0d000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000"
```

## endBlock

### End block

The last block in which the appointment is still valid

`endBlock`

- is **required**
- type: `integer`
- defined in this schema

### endBlock Type

`integer`

- minimum value: `0`
- maximum value: `9007199254740991`

### endBlock Example

```json
6052995
```

## eventABI

### Event ABI

The human readable ABI (https://blog.ricmoo.com/human-readable-contract-abis-in-ethers-js-141902f4d917) of the event
that triggers a response

`eventABI`

- is **required**
- type: `string`
- defined in this schema

### eventABI Type

`string`

### eventABI Example

```json
"event EventDispute(uint256 indexed)"
```

## eventArgs

### Event arguments

The topic arguments for the address specified in the abi

`eventArgs`

- is **required**
- type: `string`
- defined in this schema

### eventArgs Type

`string`

### eventArgs Example

```json
"0xf778daa96e1bdf7745b02debfd61d9bcc46da294dd059fa3ce13b263d06e389a"
```

## gasLimit

### Gas limit

The amount of gas that will be supplied when calling the external contract

`gasLimit`

- is **required**
- type: `string`
- defined in this schema

### gasLimit Type

`string`

### gasLimit Example

```json
"100000"
```

## id

### Id

A unique id, chosen by the customer

`id`

- is **required**
- type: `number`
- defined in this schema

### id Type

`number`

- minimum value: `0`
- maximum value: `9007199254740991`

### id Example

```json
200
```

## jobId

### Job counter

A counter used to replace appointments of the same id, but lower counter

`jobId`

- is **required**
- type: `integer`
- defined in this schema

### jobId Type

`integer`

- minimum value: `0`
- maximum value: `9007199254740991`

### jobId Example

```json
3
```

## mode

### Mode

The PISA execution mode

`mode`

- is **required**
- type: `integer`
- defined in this schema

### mode Type

`integer`

- minimum value: `0`
- maximum value: `9007199254740991`

### mode Example

```json
1
```

## paymentHash

### Payment hash

The hash received during payment

`paymentHash`

- is **required**
- type: `string`
- defined in this schema

### paymentHash Type

`string`

### paymentHash Example

```json
"0x11359291abdee43476905204ea224bd2c1ccc775f283d280ed61f8f0ce94483e"
```

## postCondition

### Post-condition

The post-condition to be executed after Pisa executes the call data

`postCondition`

- is **required**
- type: `string`
- defined in this schema

### postCondition Type

`string`

### postCondition Example

```json
"0x5bf2b49d8b43dbc21ab4b757d5bebcd3ed6d50c092aa2648c49cd76bce28c9cc"
```

## refund

### Refund

The amount to be refunded in case of failure (wei)

`refund`

- is **required**
- type: `string`
- defined in this schema

### refund Type

`string`

### refund Example

```json
"2000000000000000000"
```

## startBlock

### Start block

The block at which this appointment starts

`startBlock`

- is **required**
- type: `integer`
- defined in this schema

### startBlock Type

`integer`

- minimum value: `0`
- maximum value: `9007199254740991`

### startBlock Example

```json
6051077
```
