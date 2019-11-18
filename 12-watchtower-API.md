# WatchTower protocol specification (BOLT DRAFT)

## Overview

All off-chain protocols assume the user remains online and synchronised with the network. To alleviate this assumption, customers can hire a third party watching service (a.k.a Watchtower) to watch the blockchain and respond to channel breaches on their behalf. 

At a high level, the client sends an encrypted justice transaction alongside a transaction locator to the WatchTower. Both the encryption key and the transaction locator are derived from the breach transaction id, meaning that the WatchTower will be able to decrypt the justice transaction only after the corresponding breach is seen in the blockchain. Therefore, the WatchTower does not learn any information about the client's channel unless there is a channel breach (channel-privacy).

Due to replace-by-revocation lightning channels, the client should send data to the WatchTower for every new update in the channel, otherwise the WatchTower may not be able to respond to specific breaches. 

Finally, optional QoS can be offered by the WatchTower to provide stronger guarantees to the client, such as a signed receipt for every new job. The rationale for the receipt is to build an _accountable_ WatchTower as the customer can later use it as publicly verifiable evidence if the WatchTower fails to protect them.

The scope of this document includes: 

- A protocol for client/server communication.
- How to build appointments for the WatchTower, including key/locator derivation and data encryption.
- A format for the signed receipt. 

The scope of this bolt does not include: 

 - A payment protocol between the customer and WatchTower. 
 - WatchTower server discovery.
 

## Table of Contents 
* [Connection establishment](#connection-establishment)
	* [The `wt_init` message](#the-wt_init-message)
* [Sending and receiving appointments](#sending-and-receiving-appointments)
 	* [The `appointment` message](#the-appointment-message)
* [Transaction Locator and Encryption Key](#transaction-locator-and-encryption-key)
* [Encryption Algorithms and Parameters](#encryption-algorithms-and-parameters)
* [Signed Receipt Fields](#signed-receipt-fields)
* [Payment Modes](#payment-modes)
* [Number of updates](#number-of-updates)
* [No compression of justice transaction](#no-compression-of-justice-transaction)

## Connection establishment
Connections between the client and the server can be long-lived or restarted for every single appointment.

		+-------+                      +-------+
		|   A   |--(1)--- wt_init ---->|   B   |
		|       |<-(2)--- wt_init -----|       |
		+-------+                      +-------+
		
		- where node A is 'client' and node B is 'server'

### The `wt_init` message

This message contains the information about a node and the type of appointments he is willing to create / accept.

1. type: ? (`wt_init`)
2. data:
   * [`u16`:`aclen`]
   * [`aclen*bytes`:`accepted_ciphers`]
   * [`u16`:`modlen`]
   * [`modlen*bytes`:`modes`]
   * [`u16`:`qoslen`]
	* [`qoslen*bytes`:`qos`]	

`accepted_ciphers` define the ciphers that the sender implements and that he can use to encrypt / decrypt data. Accepted cyphers include `chacha20` and `aes-gcm-256`.

`modes` define the operation mode requested / accepted. Modes include `altruistic` and `non-altruistic`.

`qos` defines whether the sender is requesting / accepting Quality of Service for his appointments. The only QoS offered at the moment is `accountability`.

#### Requirements
The sending node: 

* MUST send `wt_init` as the first message.
* MUST set `accepted_ciphers` to the list of ciphers he implements.
* MUST set `modes` to the list of modes that he is willing to accept.
* SHOULD set `qos` to the the quality of service he is requesting / offering. 
* upon receiving `wt_init` from a node he has not started a handshake with:
	* MUST fail the connection

The requesting node: 

* MUST receive `wt_init` before sending any other message.
* MUST respond with its own `wt_init` message.
* upon receiving an `accepted_ciphers` that does not contain any of its own accepted ciphers:
	* MUST fail the connection
* upon receiving a `modes` that does not contain any of its own accepted modes:
	* MUST fail the connection
* upon receiving a `qos` that does not contain any of its own accepted QoS:
	* MUST fail the connection

#### Rationale

The client is always the one in charge of establishing the connection. A client that receives a `wt_init` from a random node must assume that the node tries to use him as a server, therefore fail. 

The client's `wt_init` message informs the server of what type of service he is requesting. The server should agree with the client if the implement the same methods. Otherwise the connection should be failed.

QoS is an optional field. Including the field in the `wt_init` message signals that the sender is requiring that specific QoS. As for accountability, it aims for giving non-repudiable proof of the agreement to both the client and the server.

The transport protocol to be used is purposely omitted. Piggybacking on top of the Lightning transport protocol as well other approaches such as interfaces over HTTP can be used to establish the connection.

[FIXME: The connection establishment and wt_init can be replaced by a node discovery algorithm that lets the server announce its policy]

## Sending and receiving appointments

Once both client and server have agreed on common modes of operation, the client can start sending appointments to the server.

		+-------+                                    +-------+
		|   A   |--(1)---      appointment      ---->|   B   |
		|       |<-(2)---   accepted/rejected   -----|       |
		+-------+                                    +-------+
		
		- where node A is 'client' and node B is 'server'

### The `appointment` message

This message contains all the information regarding the appointment that the client wants to arrange with the server.

1. type: ? (`appointment`)
2. data:
   * [`16*byte `:`locator`]
   * [`u64 `:`start_block`]
   * [`u64 `:`end_block`]
   * [`u64 `:`dispute_delta`]
   * [`varsize`:`encrypted_blob`]
   * [`u64`: `transaction_size`]
   * [`u64`: `transaction_fee`]
   * [`u16`:`cipher`]
   * [`u16`: `op_customer_signature_algorithm`]
   * [`varsize`: `op_customer_signature`]
   * [`varsize`: `op_customer_public_key`]

#### Requirements

The sending node:

* MUST set the `locator` as specified in [Transaction Locator and Encryption Key](#transaction-locator-and-encryption-key).
* MUST set the `start_block` to the block at which he requests the server to start watching for breaches.
* MUST set the `end_block` to the block at which he requests the server to stop watching for breaches.
* MUST set `dispute_delta` to the CLTV value specified in the `commitment_transaction`.
* MUST set `encrypted_blob` to the encryption of the `justice_transaction` as specified in [Transaction Locator and Encryption Key](#transaction-locator-and-encryption-key).
* MUST set `transaction_size` to the size of the serialized `justice_transaction`, in bytes.
* MUST set `transaction_fee` to the fee set in the `justice_transaction`.
* MUST set `cipher` to the cipher used to create the `encrypted_blob`.
* if `qos` was agreed on `wt_init`:
	* MUST set the `op_customer_signature_algorithm` to one of the signature algorithms agreed on `wt_init`.
	* MUST set `op_customer_signature` to the signature of the appointment using `op_customer_signature_algorithm`.
	* MUST set `op_customer_public_key` to the public key that matches the private key used to create `op_customer_signature`.

The receiving node:
* upon receiving a `transaction_fee`:
	* MUST compute the `fee_rate` set in the `justice_tx`.

The receiving node MUST reject the appointment if:

* The received locator` is not a `16-byte` value.
* The received `start_block` is not an integer.
* The received `start_block` is behind the current chain tip.
* The received `end_block` is not an integer.
* The received `end_block` is behind the current chain tip.
* The received `dispute_delta` is not an integer.
* The received `encrypted_blob` has non-feasible size.
* The received `cipher` is not among the one he implements.
* The received `transaction_size` is non-feasible.

The receiving node SHOULD reject the appointment if:

* The received `start_block` is too close to the current chain tip.
* The received `start_block` is too far away in the future.
* The received `end_block` is too far away in the future.* The received `dispute_delta` is too small.
* The `fee_rate` is too low.

* if `qos` was agreed on `wt_init`:
	The receiving node MUST also reject the appointment if:
	* The `op_customer_signature_algorithm` is missing.
	* The received `op_customer_signature_algorithm` does not match with one of the supported signing algorithms.
	* The `op_customer_signature` is missing.
	* The `op_customer_public_key` is missing.
	* The received `op_customer_signature` cannot be verified using `op_customer_public_key`.

* if `qos` was NOT agreed on `wt_init`:
	* The receiving node SHOULD also reject the appointment if:
	* if `op_customer_signature_algorithm` is present.
	* if `op_customer_signature` is present.
	* if `op_customer_public_key` is present.

The receiving node MAY accept the appointment otherwise.

#### Range of values 

- `start_block`: Absolute Block number 
- `end_block`: Absolute Block number
- `dispute_delta`: Relative Block number
- `transaction_size`: Measured in Bytes
- `transaction_fee`: Measured in sats
- `cipher`: AESGCM256, CHACHA20
- `customer_signature_algorithm`: ECDSA, SCHNORR

#### Rationale

We can group the data fields into logical groups. 

* **Appointment information**: The appointment time is defined using the `start_block` and `end_block`. WatchTower will delete the job when the appointment has expired. We recommend only using block numbers as that is the natural clock for Bitcoin. 
* **Explicit acknowledgement of transaction details**: The `dispute_delta`, `transaction_size`, and `transaction_fee` let the WatchTower confirm the transaction is "reasonable" and it can be accepted into the blockchain (especially if there is congestion in the future). 
* **Encrypted transaction**: The `cipher`,`encrypted_blob` states how the WatchTower can later find the dispute transaction and decrypt the justice transaction. 
* **Customer signature** The `customer_public_key` and `customer_signature` provides an explicit message about the job from the customer.  The `customer_public_key` can also be used for refunds if applicable.

The transaction `locator` can be deterministically computed by both the client and the server. Locators of wrong size are therefore invalid.

`start_block` and `end_block` too close to the current chain tip may result in the tower missing the trigger and therefore should be avoided.

Too far away is a subjective concept. Towers accepting jobs that start in the far future or that may last a really long time risk having to store data for long periods of time and should, therefore, by avoided.

The concept of too small for `dispute_delta` is also subjective. The `dispute_delta` defines how many blocks the server will have to respond with the `justice_transaction` after a breach is seen. The smallest the value, the more the server risks to fail the appointment.

The `encrypted_blob` should have been encrypted using `cipher`. Block ciphers have a size multiple of the block length, which depends on the key size. Therefore some incorrect `encrypted_blob` can be spotted checking the `transaction_size`. Moreover, `encrypted_blob` have to be at least as big as:

`cipher_block_size * ceil(minimum_viable_transaction_size / cipher_block_size)`

And at most as big as:

`cipher_block_size * ceil(maximum_viable_transaction_size / cipher_block_size`) 

`minimum_viable_transaction_size` and `maximum_viable_transaction_size` refer to the minimum/maximum size required to create a valid transaction. Accepting `encrypted_blob` outside those boundaries will ease DoS attacks on the server.

`transaction_size` and `transaction_fee` help the WatchTower to decide on the likelihood of an appointment being fulfilled. Appointments with `fee_rate` too low may be rejected by the WatchTower, specially if `QoS` is required. While a customer can always fake this values, it should break ToS between the client and the server and, therefore, release the WatchTower of any liability.

A WatchTower can ignored non-agreed `QoS`, but must enforce the agreed ones. Generally, this standard is trying to allow a reputationally accountable watching service. The signed job from the customer provides an explicit acknowledgement of the transaction details that is important for the WatchTower to decide whether they can accept it. If the decrypted justice transaction does not satisfy the signed job (e.g. fee too low), then the WatchTower is not obliged to fulfil it. 

The _explictiness_ of the signed job ensures there is a clear protocol transcript between the customer and WatchTower. Given the blockchain and decrypted justice transaction, anyone can verify that the WatchTower could have satisfied the job. 

### The `appointment_accepted` message

This message contains information about the acceptance of an appointment from the WatchTower.

1. type: ? (`appointment_accepted `)
2. data:
   * [`16*byte `:`locator`]
   * [`varsize`: `op_receipt`]
   * [`u16`: `op_wt_signature_algorithm`]
   * [`varsize`: `op_wt_signature`]
   * [`varsize`: `op_wt_public_key`]

The sending node:

* MUST receive `appointment` before sending an `appointment_accepted` message.
* MUST set the `locator` to match the one received in `appointment`.
* if `qos` was agreed on `wt_init`:
	* MUST set `op_receipt`] to a receipt build according to 	 [Signed-Receipt](#signed-receipt)
	* MUST set `op_wt_signature_algorithm` to one of the signature algorithms agreed on `wt_init`.
	* MUST set `op_wt_signature` to the signature of the appointment using `op_customer_signature_algorithm`.
	* MUST set `op_wt_public_key` to the public key that matches the private key used to create `op_customer_signature`.

The receiving node:

* MUST fail the connection if:
	* The received `locator` does not match any of the previously sent to the WatchTower.

* if `qos` was agreed on `wt_init`:
The receiving node MUST also reject the appointment if:
	* The received `op_receipt` does not matches the format specified at 	[Signed-Receipt](#signed-receipt)
	* The `op_receipt` fields do not match the ones sent in the `appointment` message.
	* The `op_wt_signature_algorithm` is missing.
	* The received `op_wt_signature_algorithm` does not match with one of the supported signing algorithms.
	* The `op_wt_signature` is missing.
	* The `op_wt_public_key` is missing.
	* The received `op_wt_signature` cannot be verified using `op_wt_public_key`.

### The `appointment_rejected` message

This message contains information about the rejection of an appointment from the WatchTower.

1. type: ? (`appointment_rejected `)
2. data:
   * [`16*byte `:`locator`]
   * [`u16`: `rcode`]
   * [`varsize`: `reason`]

The sending node:

* MUST receive `appointment` before sending an `appointment_accepted` message.
* MUST set the `locator` to match the one received in `appointment`.
* MUST set `rcode` to the rejection code.
* SHOULD set `reason` to a description of the rejection reason.

## Transaction Locator and Encryption Key

Implementations MUST compute the `locator`, `encryption_key` and `encryption_iv` from the commitment transaction as defined below: 

- `locator`: first half of the commitment transaction id (`commintment_txid(0,16]`)
- `master_key`: Hash of the second half of the commitment transaction id (`SHA256(commintment_txid(16,32])`) 
- `encryption_key`: first half of the master key (`master_key(0,16]`)
- `encryption_iv`: second half of the master key (`master_key(16,32]`)


The server (WatchTower) relies on both the encryption key and iv to decrypt the justice transaction. Furthermore, the transaction locator helps the WatchTower identify a breach transaction on the blockchain. 

## Encryption Algorithms and Parameters

All clients and servers MUST use one of the following encryption algorithms: 

- ChaCha20 (https://tools.ietf.org/html/rfc7539)
- AES-GCM-256 (https://tools.ietf.org/html/rfc5288)

Sample code (python) for the client to prepare the `encrypted_blob`: 

	from hashlib import sha256
	from binascii import hexlify
	
	def encrypt(justice_tx, commitment_txid):
	    # master_key = SHA256(commitment_txid(16, 32])
	    master_key = sha256(commitment_txid[16:]).digest()
	
	    # The 16 MSB of the master key will serve as the AES-GCM-256 secret key. The 16 LSB will serve as the IV.
	    sk = master_key[:16]
	    nonce = master_key[16:]
	
	    # Encrypt the data
	    aesgcm = AESGCM(sk)
	    encrypted_blob = aesgcm.encrypt(nonce=iv, data=tx, associated_data=None)
	    encrypted_blob = hexlify(encrypted_blob).decode()
	
	    return encrypted_blob
	    
## Signed Receipt

### Sanity checks

The server (WatchTower) must perform some sanity checks on the job request before sending a signed receipt to the client. The sanity checks are implementation-specific, but we recommend that the WatchTower checks the satoshi per byte (`transaction_fee/transaction_size`) and that the dispute delta satisfies a minimum (i.e. sufficient time to complete the job). 

### Receipt Format 

The server (WatchTower) MUST respond to the client using the following format: 

```
{"txlocator": 16*byte, 
"start_time": u64, 
"end_time": u64,
"dispute_delta": u64, 
"encrypted_blob": varsize,
"transaction_size": u64,
"transaction_fee": u64,
"cipher": u16, 
"customer_public_key": varsize,
"wt_public_key": varsize,
"payment_hash": u64
"payment_secret:" u64 [optional]}
```

[ FIXME: define signature serialization format]

#### Rationale

We assume the server has a well-known public key for the WatchTower. It is outside the scope of this BOLT to dictate how the public key is retrieved and associated with the WatchTowers identity. 

- **Conditional transfer**: Both ```payment_hash``` and ```payment_secret``` can be used to provide a fair exchange of the signed receipt and WatchTower payment over the lightning network. If the WatchTower is willing to accept a job without a new payment, then it will return the ```payment_secret``` immediately. 

## Payment modes 

Although this BOLT does not enforce any specific payment method to be adopted, it is worth mentioning the three most common ones:

**On-chain bounty**. An additional output is created in the justice transaction that will reward the WatchTower. 

**Micropayments**. A small payment is sent to the WatchTower for every new job (i.e. over the lightning network)

**Subscription**. WatchTower is periodically rewarded / paid for their service to the customer. (i.e. over the lightning network or fiat subscription). 

Both micropayments and subscriptions are favourable for a WatchTower.

**Problems with onchain bounty** We highlight that the on-chain bounty approach is not ideal for a watching network. It lets the customer hire N WatchTowers (O(N) storage for each tower) and only one WatchTower will be rewarded upon collecting the bounty. On top of that, the onchain bounty allows a network-wise DoS attack for free.


## No compression of justice transaction 

The storage requirements for a WatchTower can be reduced (linearly) by implementing [shachain](https://github.com/rustyrussell/ccan/blob/master/ccan/crypto/shachain/design.txt), therefore storing the parts required to build the transaction and the corresponding signing key instead of the full transaction. For this BOLT, we have decided to keep the hiring protocol simple. Storage is relatively cheap and we can revisit this standard if it becomes a problem. 

## Acknowledgments


## Authors

Patrick McCorry, Sergi Delgado, PISA Research. 

![Creative Commons License](https://i.creativecommons.org/l/by/4.0/88x31.png "License CC-BY")
<br>
This work is licensed under a [Creative Commons Attribution 4.0 International License](http://creativecommons.org/licenses/by/4.0/).
