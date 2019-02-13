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