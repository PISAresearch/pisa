# Raiden Demo

The raiden demo shows a POC integration with the Raiden node. It involves two demo scenarios:
1) Closing a channel with one participant offline without PISA
2) Closing a channel with one participant offline with PISA

In the first the offline participant will lose any funds that had been sent to them by their counterparty. In the second they won't as PISA will submit their latest balance proof.


## A quick run down on how Raiden works:
A participant opens a channel with another participant. To do this they need to know the Ethereum address of the other participant, or they can 'connect' to a network and be randomly assigned peers. Once the channel is opened one, or both, participants deposits funds into the channel. Now the parties can pay each other. A payment involves creating a "Balance proof" which shows the intent to pay a certain value, and is signed by the paying party. When one party wishes to close the channel, they submit a 'close' message to the block chain which triggers the start of a settlement window. During that settlement window each participant must submit all the balance proofs that they received from their counterparty, if they do not they will not receive any balances associated with them. After the settlement period is complete one of the parties then calls "settle" to unlock the funds from the channel.

## Why PISA?
If a party is offline when their counterparty calls 'close' they will not be able to submit balance proofs. If they do not do this before the settlement window finishes they will lose any funds associated with these proofs. To alleviate this a party can do the following:
1) Upon receiving a balance proof they pass a copy to PISA
2) If they go offline and the channel is closed then PISA will submit balance proofs on their behalf.

## Demo overview
### Scenario 1
1) Alice sets up a Raiden node
2) Bob sets up a Raiden node
3) Alice sets up a channel with Bob
4) Alice sends some funds to Bob
5) Bob goes offline
6) Alice closes the channel
7) Alice waits for the settle timeout, then calls settle
8) Bob comes back online, checks his balance, and sees that the funds are gone

### Scenario 2
1) Alice sets up a Raiden node
2) Bob sets up a Raiden node
3) Bob runs a RaidenPisaDaemon alongside his Raiden node, this daemon has access to a PISA tower
4) Alice sets up a channel with Bob
5) Alice sends some funds to Bob
6) Bob goes offline
7) Alice closes the channel
8) Alice waits for the settle timeout, then calls settle
9) Bob comes back online, checks his balance, and sees that the funds are there

## Components

## Alterations to Raiden

## Alterations to PISA

## Setup

## Running Scenario 2 on Ropsten

1. Download [raiden binaries](https://github.com/raiden-network/raiden/releases) and unzip it.

2. Download geth (no need to sync). NOTE: Instructions here assume there are no previous Ropsten accounts.

3. Create two accounts (say A and B) from geth:
   ```geth --testnet account add```

   Run the above twice and follow instructions; remember the passwords.

4. Take note of addresses and keyfile location of the new accounts; the addresses need to be checksummed. Enter `geth --testnet console`, then take note of the results of: `web3.toChecksumAddress(eth.accounts[0])` and `web3.toChecksumAddress(eth.accounts[1])`.

5. Get Ropsten ether for A and B from a [ropsten faucet](https://faucet.ropsten.be/).

6. Get WETH for A and B. (Contract address on Ropsten: 0xc778417E063141139Fce010982780140Aa0cD5Ab)
   By importing the accounts on Metamask, you can do this [here](https://ropsten.etherscan.io/address/0xc778417e063141139fce010982780140aa0cd5ab#writeContract) by sending ether to the deposit() function.

7. Create files `password-a.txt` and `password-b.txt` containing each one line with the corresponding password.

8. Start a raiden node for A:
   ```./raiden --gas-price fast --accept-disclaimer --api-address 127.0.0.1:<port-a> --network-id ropsten --eth-rpc-endpoint https://ropsten.infura.io/v3/6a750ee18d924477b219e6cea6de2215 --address <address-a> --password-file ./password-a.txt```

   (NOTE: assuming default locations for the keystore files; check `./raiden --help` otherwise).

   Take note of the location of the sqlite database when raiden is loading.

9. Start a raiden node for B as above.

10. Using B's raiden UI, open an channel with A, for some small amount of WETH. The GUI is at 127.0.0.1:<port-b> .

11. Navigate to /pisa. Build if needed:

    ```npm install && npm run build```

    Start pisa:

    ```npm run start-dev```

12. Navigate to /pisa/raiden_demo/raiden-pisa-daemon. Install dependencies with `npm install` and start the raiden-pisa-damon:

    ```npm start -- --keyfile=<keyfile for A> --p=<password of the keyfile> --db=<dblocation> --pisa=pisahost:pisaport ```

13. Make a payment from B to A using the raiden GUI. After some time (~15 secs) you should notice that the daemon registers an update, and that it calls pisa.

14. Now stop the raiden node for A.

15. Now use B to close the channel.

16. Pisa will now supply the latest balance update for A.

17. Now wait 500 blocks for the settlement period to endpoint.

18. Now turn on raiden node A again, and notice that their balance includes the payment made in 13.