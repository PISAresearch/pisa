# Raiden Demo
⚠ This integration is for demo purposes only. It follows a specific script, is built for a specific purpose. It is not a full integration between Raiden and PISA and should not be used as such ⚠

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
### Scenario 1 - Alice is not protected
1) Alice sets up a Raiden node
2) Bob sets up a Raiden node
3) Alice sets up a channel with Bob
4) Alice sends some funds to Bob
5) Bob goes offline
6) Alice closes the channel
7) Alice waits for the settle timeout, then calls settle
8) Bob comes back online, checks his balance, and sees that the funds are gone

### Scenario 2 - Carol is Pisa protected
1) Carol sets up a Raiden node
2) Dave sets up a Raiden node
3) Carol runs a RaidenPisaDaemon alongside his Raiden node, this daemon has access to a PISA tower
4) Dave sets up a channel with Bob
5) Dave sends some funds to Bob
6) Carol goes offline
7) Dave closes the channel
8) Carol waits for the settle timeout, then calls settle
9) Carol comes back online, checks his balance, and sees that the funds from the payment are there

## Components

## Alterations to Raiden

The raiden-contracts repo needs to be altered to reduce the settlement timeout. The current minimum settlement timeout for raiden is 500 blocks = ~2 hours which is too long for a demo. There an altered set of contracts with a minimum settlement period of 5 blocks must be deployed. 

Adjust the following before deploying: https://github.com/raiden-network/raiden-contracts/blob/master/raiden_contracts/constants.py#L26

The raiden node then needs an update to reflect this. Due to a relationship between reveal timeout and settlement timeout: that settle > 2 * reveal, we need to reduce the reveal timeout in the following place to 2: https://github.com/raiden-network/raiden/blob/master/raiden/settings.py#L29

## Running the demo on localhost - blocks mine at 1 per second

0. Install docker, docker-compose and python3
1. Download the pisa source code
2. Navigate to the /raiden_demo/
3. ```rm -rf .raiden```
4. docker-compose -f docker/parity-preloaded.docker-compose.yml
5. execute each of the commands in scenarios/local_1.txt in a new terminal tab
6. open a new terminal window and execture each of the commands in scenarios/local_2.txt in new terminal tabs
7. Install the demo chrome extension by browsing to chrome://extensions, selecting Developer Mode in the top right, the clicking Load Unpacked in the top left. From the select the raiden-webui-hook-extension folder.
8. Open each of localhost:6660 (Alice), localhost:6661 (Bob), localhost:6662 (Carol), localhost:6663 (Dave) in new chrome windows. Carol's window should show + PISA in the title bar due to the chrome extension.
9. Check that all parties have balance in the correct token by selecting Tokens in the UI.
10. For Bob and Dave, navigate to Channels. Click the + to make a new channel to Aice and Carol respectively. Choose a settlement timeout of 5.
11. Now the demo is setup and ready to go
12. Make a payment from Bob to Alice, and then from Dave to Carol
13. Take the Alice and Carol nodes offline by stopping those processes in the terminal
14. Use Bob and Dave's UI to close the channels
15. Wait for the settlement period to expire - this will be reflected in the UI
16. Restart the Alice and Carol nodes
17. Navigate to the Tokens tab for Alice and Carol to see the different balances

## Running the demo on Ropsten - blocks mine 1 per 15 sec

Does as for local, except:
1. Use the commands in scenarios/remote_1.txt and scenarios/remote_2.txt
2. Be careful about clearing out the .raiden directory, always start the raiden nodes to check if any channels are open before doing this. If this dir is deleted whilst a channel is in the settlement period it cannot be recovered.
3. On Ropsten each of the accounts has 0.5 WETH, sending WETH in the channel will change these balances. After doing a demo send some WETH backwards from Carol to Dave to reset the balances - the easiest way to do this is to open a channel, send the funds and close it.