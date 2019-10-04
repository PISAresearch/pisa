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

**Note:** Pisa is alpha stage software and is not yet available on mainnet. Do not use with real funds.

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

Make sure that the relevant ports are open. You can run Pisa with the following command:

```
npm run start
```
