# WatchTower protocol specification (BOLT DRAFT)

## Overview

All off-chain protocols assume the user remains online and synchronised with the network. To alleviate this assumption, customers can hire a third party watching service (a.k.a Watchtower) to watch the blockchain and respond to channel breaches on their behalf. 

At a high level, the client sends an encrypted justice transaction alongside a transaction locator to the WatchTower. Both the encryption key and the transaction locator are derived from the breach transaction id, meaning that the WatchTower will be able to decrypt the justice transaction only after the corresponding breach is seen in the blockchain. Therefore, the WatchTower does not learn any information about the client's channel unless there is a channel breach (channel-privacy).

Due to replace-by-revocation lightning channels, the client should send data to the WatchTower for every new update in the channel, otherwise the WatchTower may not be able to respond to specific breaches. 

Finally, optional QoS can be offered by the WatchTower to provide stronger guarantees to the client, such as a signed receipt for every new job. The rationale for the receipt is to build an _accountable_ WatchTower as the customer can later use it as publicly verifiable evidence if the WatchTower fails to protect them.

The scope of this document includes: 

- A protocol for client/server comunication.
- How to build appointments for the WatchTower, inluding key/locator derivation and data encryption.
- A format for the signed receipt. 

The scope of this bolt does not include: 

 - A payment protocol between the customer and WatchTower. 
 - WatchTower server discovery.
 

## Table of Contents

  * [Transaction Locator and Encryption Key](#transaction-locator-and-encryption-key)
  * [Encryption Algorithms and Parameters](#encryption-algorithms-and-parameters)
  * [WatchTower API](#WatchTower-api)
  * [Signed Receipt Fields](#signed-receipt-fields)
  * [Payment Modes](#payment-modes)
  * [Number of updates](#number-of-updates)
  * [No compression of justice transaction](#no-compression-of-justice-transaction)

## Transaction Locator and Encryption Key

Implementations MUST compute the `tx_locator`, `encryption_key` and `encryption_iv` from the commitment transaction as defined below: 

- `tx_locator`: first half of the breach transaction id (`breach_txid(0,16]`)
- `master_key`: Hash of the second half of the breach transaction id (`H(breach_txid(16,32])`) 
- `encryption_key`: first half of the master key (`master_key(0,16]`)
- `encryption_iv`: second half of the master key (`master_key(16,32]`)


The reader (WatchTower) relies on both the encryption key and iv to decrypt the justice transaction. As well, the transaction locator helps the WatchTower identify a breach transaction on the blockchain. 

## Encryption Algorithms and Parameters

All writers and readers MUST use one of the following encryption algorithms: 

- ChaCha20 (https://tools.ietf.org/html/rfc7539)
- AES-GCM-256 (https://tools.ietf.org/html/rfc5288)

Sample code (python) for the writer (client) to prepare the encrypted blob: 

	from hashlib import sha256
	from binascii import hexlify
	
	def encrypt(justice_tx, breach_txid):
	    # master_key = H(breach_txid(16, 32])
	    master_key = sha256(breach_txid[16:]).digest()
	
	    # The 16 MSB of the master key will serve as the AES-GCM-256 secret key. The 16 LSB will serve as the IV.
	    sk = master_key[:16]
	    nonce = master_key[16:]
	
	    # Encrypt the data
	    aesgcm = AESGCM(sk)
	    encrypted_blob = aesgcm.encrypt(nonce=iv, data=tx, associated_data=None)
	    encrypted_blob = hexlify(encrypted_blob).decode()
	
	    return encrypted_blob
    

## WatchTower API

The following format MUST be required for ALL hiring requests: 

```
{
"txlocator": string,
"start_block": uint, 
"end_block": uint,
"dispute_delta": uint, 
"encrypted_blob": string,
"cipher": string, 
"hash_function": string
}
```

Furthermore, the following fields COULD be added for QoS:

```
{
"transaction_size": uint,
"transaction_fee": uint,
"customer_address": string,
"customer_signature_algorithm": string,
"customer_signature": string
}
```


### Range of values 

- ```start_block```: (Absolute) Block number 
- ```end_block```: (Absolute) Block number
- ```dispute_delta```: (Relative) Block number
- ```transaction_size```: Measured in Bytes (e.g. 200) 
- ```transaction_fee```: Measured in sats (e.g. 2000)
- ```cipher```: AESGCM256, CHACHA20
- ```hash_function```: SHA256
- ```customer_signature_algorithm```: ECDSA, SCHNORR


### Rationale

We can group the data fields into logical groups. 

* **Appointment information**: The appointment time is defined using the ```start_block``` and```end_block```. WatchTower will delete the job when the appointment has expired. We recommend only using block numbers as that is the natural clock for Bitcoin. 
* **Explicit acknowledgement of transaction details**: The ```dispute_delta```, ```transaction_size```, and ```transaction_fee``` let the WatchTower confirm the transaction is "reasonable" and it can be accepted into the blockchain (especially if there is congestion in the future). 
* **Encrypted transaction**: The ```cipher```,```hash_function```,```encrypted_blob``` states how the WatchTower can later find the dispute transaction and decrypt the justice transaction. 
* **Customer signature** The ```customer_address``` and ```customer_signature``` provides an explicit message about the job from the customer. 

Generally, this standard is trying to allow a reputationally accountable watching service. The signed job from the customer provides an explicit acknowledgement of the transaction details that is important for the WatchTower to decide whether they can accept it. If the decrypted justice transaction does not satisfy the signed job (e.g. fee too low), then the WatchTower is not obliged to fulfil it. 

The _explictiness_ of the signed job ensures there is a clear protocol trasncript between the customer and WatchTower. Given the blockchain and decrypted justice transaction, anyone can verify that the WatchTower could have satisified the job. 

## Signed Receipt Fields

### Sanity check

The reading node (WatchTower) must perform a sanity check on the job request before sending a signed receipt to the writer (customer). The sanity check is implementation-specific, but we recommend that the WatchTower checks the satoshi per byte (```transaction_fee/transaction_size```) and that the dispute delta satisifies a minimum (i.e. sufficient time to complete the job). 

### Receipt Format 

The writer (WatchTower) MUST respond to the customer using the following format: 

```
{"txlocator": string, 
"start_time": uint, 
"end_time": uint,
"dispute_delta": uint, 
"transaction_size": uint,
"transaction_fee": uint,
"encrypted_blob": string,
"cipher": string, 
"hash_function": string,
"customer_address": string,
"customer_signature": string,
"payment_hash": string
"payment_secret:" string [optional], 
"watchtower_signature_algorithm": string,
"watchtower_signature": string"}
```

The reader (customer's wallet software) MUST verify the WatchTower's signature before assuming the job was accepted. 

[ FIXME: define signature serialization formats]

### Range of values 

The ```watchtower_signature_algorithm``` can be ECDSA or SCHNORR. The other new fields are self-explanatory. 

### Rationale

We assume the reader has a well-known public key for the WatchTower. It is outside the scope of this BOLT to dictate how the public key is retrieved and associated with the WatchTowers identity. 

The signed receipt includes two new groupings: 
- **Verifying WatchTower signature**: Both ```watchtower_signature_algorithm``` and ```watchtower_signature``` informs the reader how to verify the receipt's signature. 
- **Conditional transfer**: Both ```payment_hash``` and ```payment_secret``` can be used to provide a fair exchange of the signed receipt and WatchTower payment over the lightning network. If the WatchTower is willing to accept a job without a new payment, then it will return the ```payment_secret``` immediately. 

## Payment modes 

It is outside the scope of this BIP to dictate how a customer will pay the WatchTower. Generally, there are three approaches: 

**On-chain bounty**. An additional output is created in the justice transaction that will reward the WatchTower. 

**Micropayments**. A small payment is sent to the WatchTower for every new job (i.e. over the lightning network)

**Subscription**. WatchTower is periodically rewarded / paid for their service to the customer. (i.e. over the lightning network or dirty fiat subscription). 

Both micropayments and subscriptions are favourable for a WatchTower.

**Problems with onchain bounty** We highlight that the on-chain bounty approach is not ideal for a watching network. It lets the customer hire N WatchTowers (O(N) storage for each tower) and only one WatchTower will be rewarded upon collecting the bounty. If this approach was sought, then the miners may end up becoming WatchTowers as they can very easily front-run an entire watching network. Thus to reduce the power and responsibility of miners, we should avoid this approach and advocate that miners do not participate in a watching network. 
 
## Number of updates

To offer full protection, a WatchTower requires an encrypted blob for every single update in the channel. This is a symptom of replace-by-revocation channels as there is a single valid state and a set of "revoked" states. Only one of the states can be broadcast and this is up to the counterparty (cheater) to decide. 

All signed receipts only correspond to a single job / justice transaction. Thus the customer should keep a copy of all signed receipts received from the WatchTower. A future BOLT can extend the signed receipt to include a committment to all previous encrypted blobs (merkle tree) to reduce this storage. 

## No compression of justice transaction 

There are tricks using [hashchains](https://github.com/rustyrussell/ccan/blob/master/ccan/crypto/shachain/design.txt) to reduce the storage requirements for each justice transaction. For this BOLT, we have decided to keep the hiring protocol simpe in order to get WatchTowers up and running. Stroage is relatively cheap and we can revisit this standard if it becomes a problem. 

## Acknowledgments


## Authors

Patrick McCorry, Sergi Delgado, PISA Research. 

![Creative Commons License](https://i.creativecommons.org/l/by/4.0/88x31.png "License CC-BY")
<br>
This work is licensed under a [Creative Commons Attribution 4.0 International License](http://creativecommons.org/licenses/by/4.0/).
