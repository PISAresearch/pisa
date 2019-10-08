[![CircleCI](https://circleci.com/gh/PISAresearch/pisa.svg?style=shield)](https://circleci.com/gh/PISAresearch/pisa)
[![codecov](https://codecov.io/gh/PISAresearch/pisa/branch/master/graph/badge.svg)](https://codecov.io/gh/PISAresearch/pisa)


# PISA - A Financially Accountable Relayer and Responder

The goal of a third party broadcasting network is to remove the friction and overhead of dealing with the transaction stack when building dapps. Generally, there are two node-types: 

- **Relayer:** Eventually deliver a transaction to the blockchain,
- **Responder:** Watch and respond to on-chain events.

**Why the distinct roles?** Relayers help when the user lacks access to the native token (e.g. onboarding, mixing protocols, etc), whereas responders help alleviate the user liveness requirement (e.g. auctions, offchain, CDPs, etc). 

## How does PISA help?

The PISA infrastructure provides a **simple plug & play infura-like API** to handle relaying transactions and watching for on-chain events, so dapp developers don't have to. 

It may sound like a simple problem to solve, but there are many subtle difficulties: 

- Dependent/chained transactions, 
- Re-bumping transaction fees, 
- Managing balance in wallets to pay gas fees, 
- Handling block re-orgs & hard-fork upgrades, 
- Watching for an emitted event, 
- Fetching emitted event data to use in a response.

In fact, **combining two or more** of the above makes the task non-trivial, hard, and just straight-up tedious. 

So we have built PISA to help resolve many of the above problems. Dapp developers can just plug us in and we'll handle transaction delivery for them. 

## Why trust PISA?

The PISA protocol is one of **the first financially accountable third parties**. It relies on crypto-economics and self-enforcing smart contracts to minimise (and help quantify) trust in the PISA operator. In a way, the service level agreement between PISA and the customer is processed via the blockchain if there is a dispute. Neat!  

In a nutshell, the PISA service stakes a large security deposit via the PISA contract. If PISA fails to deliver a transaction for the customer, then the customer has a *signed receipt* as evidence PISA accepted the job and *on-chain evidence* that the job was never completed. The customer can simply provide both pieces of evidence to the PISA contract which triggers a challenge period. The PISA service must refund the customer a pre-agreed amount, otherwise its staked security deposit is eventually slashed. 

## When can I start using PISA? 

So do you want to outsource the responsibility of dealing with the transaction stack? 

*Then contact us at paddy@pisa.watch.* 

As well, check out the following set of standards that we are working on: 

* Data Registry (log events) - https://github.com/ethereum/EIPs/pull/2095 
* Example of contract logging events (super simple) - https://github.com/PISAresearch/pisa/blob/master/sol/contracts/ChallengeClosureContract.sol 

# Installation
Clone the repository and install the requirements:
```
git clone https://github.com/PISAresearch/pisa.git
cd pisa
npm install
```

## Run tests

```
npm run test               # run unit and end-to-end tests
npm run test-unit          # only run unit tests
npm run test-endtoend      # only run end-to-end tests
npm run test-integration   # run integration-tests
npm run test-contract      # run smart contract's unit tests
```

## Build production instance

```
npm run build              # build PISA
npm run build-client       # build the client library
```

# Hiring Pisa

**Note:** Pisa is alpha stage software and is not yet available on mainnet. All specifications and APIs are subject to change at any time. Do not use with real funds.

We are running a live instance of Pisa on Ropsten testnet. The API endpoint is https://alpha.pisa.watch, and the contract address is "0xA02C7260c0020343040A504Ef24252c120be60b9".

The easiest way to hire Pisa is by using our client library, which automates some of the tasks that need to be performed to use our API.

At this time, only a client library for JavaScript/TypeScript is available. Please find more details [here](client).

# Run a local Pisa instance

The instructions in this sections explain how to setup and run a Pisa service.

## Deploy Pisa contracts

Deploy the DataRegistry and PisaHash contracts from the `/sol` folder (you can do it via Remix). Take note of the contract addresses.

## Create config file

Create a `config.json` file in the main PISA folder. Here is an example to get started:

```
{
    "dbDir": "pisa-db",
    "hostName": "localhost", // host name of the Pisa server
    "hostPort": 3000,        // port number of the Pisa server
    "pisaContractAddress": <pisa contract address>
    "jsonRpcUrl": <url of your node's rpc>,
    "responderKey": <private key of the wallet that the Pisa will use to send transactions>,
    "receiptKey": <private key of the wallet that Pisa will use to sign the appointments>
}
```

Run `npm run start -- --help` to see all the available settings. The same settings can also be provided via the command line. Settings provided via the command line override the ones in `config.json`.

## Run a Pisa Tower

Make sure that the PISA "host" port is available and not blocked by a firewall. After you have built it, you can run Pisa with the following command:

```
npm run start
```
