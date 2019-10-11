# BOLT #12: An External Accountable WatchTower API (DRAFT)

## Overview

All off-chain protocols assume the user remains online and synchronised with the network. To alleviate this assumption, customers can hire a third party watching service ('WatchTower') to watch the blockchain and respond to malice disputes on their behalf. 

At a high level, the customer fetches the commitment transaction and splits the transaction id into an encryption key and IV. Both are used to encrypt the justice transaction ('encrypted blob'). As well, the customer hashes the transaction id to compute a transaction locator ('txlocator'). The WatchTower is sent both the encrypted justice transaction and txlocator, and in return the customer receives a signed receipt to acknowledge the job was accepted. To find malice disputes, the WatchTower must hash every transaction id in every new block. If it finds the txlocator, then the WatchTower derives the encryption key from the transaction id, decrypts the justice transaction and broadcasts it to the network. 

A WatchTower can only protect the user against crash failure (DDoS), and not if their private signing key is compromised. As well, the watching service does not learn the information about the customer's channel unless there is a malice on-chain dispute (channel-privacy). The WatchTower cannot trigger disputes on the customer's behalf and it can only respond to malice disputes. 

Due to replace-by-revocation lightning channels, the customer MUST hire the WatchTower for every new update in their channel (full protection). In return, the customer receives a signed receipt from the WatchTower for every new job. The rationale for the receipt is to build an _accountable_ WatchTower as the customer can later use it as publicly verifiable evidence if the WatchTower fails to protect them.

The scope of this bolt includes: 
- A standard API for wallet software to implement, 
- How to prepare the encrypted justice transaction for the WatchTower, 
- A format for the signed receipt. 

The scope of this bolt does not include: 
 - A payment protocol between the customer and WatchTower. 
 - How the wallet software finds the WatchTower to hire. 
 

## Table of Contents

  * [Transaction Locator and Encryption Key](#transaction-locator-and-encryption-key)
  * [Encryption Algorithms and Parameters](#encryption-algorithms-and-parameters)
  * [WatchTower API](#WatchTower-api)
  * [Signed Receipt Fields](#signed-receipt-fields)
  * [Payment Modes](#payment-modes)
  * [Number of updates](#number-of-updates)
  * [No compression of justice transaction](#no-compression-of-justice-transaction)

## Transaction Locator and Encryption Key

Implementations MUST compute the transaction locator (```tx_locator```), the encryption key (```encryption_key```) and the encryption iv (```encryption_iv```) from the commitment transaction as defined below: 

- ```encryption_key```: (0,16] bytes of the transaction id (txid)
- ```encryption_iv```: (16,32] of the transaction id (txid)
- ```tx_locator```: SHA256(txid || txid), where || denonates concatenation. 

The reader (WatchTower) relies on both the encryption key and iv to decrypt the justice transaction. As well, the transaction locator helps the WatchTower identify a malice dispute on the blockchain. 

## Encryption Algorithms and Parameters

All writers and readers MUST use one of the following encryption algorithms: 

- ChaCha20 (https://tools.ietf.org/html/rfc7539)
- AES_GCM (https://tools.ietf.org/html/rfc5288)

Sample code (python) for the writer (wallet software) to prepare the encrypted blob: 

    def encrypt(tx, tx_id):
        # master_key = H(tx_id | tx_id)
        master_key = sha256(tx_id + tx_id).digest()

        # The 16 MSB of the master key will serve as the AES GCM 128 secret key. The 16 LSB will serve as the IV.
        sk = master_key[:16]
        nonce = master_key[16:]

        # Encrypt the data
        aesgcm = AESGCM(sk)
        encrypted_blob = aesgcm.encrypt(nonce=nonce, data=tx, associated_data=None)
        encrypted_blob = hexlify(encrypted_blob).decode()

        return encrypted_blob
    

## WatchTower API

The following format MUST be required for ALL hiring requests: 
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
"customer_signature_algorithm": string,
"customer_signature": string}
```

### Range of values 

- ```start_time```: (Absolute) Block number 
- ```end_time```: (Absolute) Block number
- ```dispute_delta```: (Relative) Block number
- ```transaction_size```: Measured in Bytes (e.g. 200) 
- ```transaction_fee```: Measured in sats (e.g. 2000)
- ```cipher```: AESGCM, CHACHA20
- ```hash_function```: SHA256
- ```customer_signature_algorithm```: ECDSA, SCHNORR


### Rationale

We can group the data fields into logical groups. 

* **Appointment information**: The appointment time is defined using the ```start_time``` and```end_time```. WatchTower will delete the job when the appointment has expired. We recommend only using block numbers as that is the natural clock for Bitcoin. 
* **Explicit acknowledgement of transaction details**: The ```dispute_delta```, ```transaction_size```, and ```transaction_fee``` let the WatchTower confirm the transaction is "reasonable" and it can be accepted into the blockchain (especially if there is congestion in the future). 
* **Encrypted transaction**: The ```cipher```,```hash_function```,```encrypted_blog``` states how the WatchTower can later find the dispute transaction and decrypt the justice transaction. 
* **Customer signature** The ```customer_address``` and ```customer_signature``` provides an explicit message about the job from the customer. 

Generally, this standard is trying to achieve a reputationally accountable watching service. The signed job from the customer provides an explicit acknowledgement of the transaction details that is important for the WatchTower to decide whether they can accept it. If the decrypted justice transaction does not satisfy the signed job (e.g. fee too low), then the WatchTower is not obliged to fulfill it. 

The _explicitness_ of the signed job ensures there is a clear protocol trasncript between the customer and WatchTower. Given the blockchain and decrypted justice transaction, anyone can verify that the WatchTower could have satisified the job. 

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

All signed receipts only correspond to a single job / justice transaction. Thus the customer should keep a copy of all signed receipts received from the WatchTower. A future BOLT can extend the signed receipt to include a committment to all previous encrypted blobs (Merkle tree) to reduce this storage. 

## No compression of justice transaction 

There are tricks using [hashchains](https://github.com/rustyrussell/ccan/blob/master/ccan/crypto/shachain/design.txt) to reduce the storage requirements for each justice transaction. For this BOLT, we have decided to keep the hiring protocol simple in order to get WatchTowers up and running. Storage is relatively cheap and we can revisit this standard if it becomes a problem. 

## Acknowledgments


## Authors

Patrick McCorry, Sergi Delgado, PISA Research. 

![Creative Commons License](https://i.creativecommons.org/l/by/4.0/88x31.png "License CC-BY")
<br>
This work is licensed under a [Creative Commons Attribution 4.0 International License](http://creativecommons.org/licenses/by/4.0/).
