# WatchTower protocol specification (BOLT DRAFT)

## Overview

All off-chain protocols assume the user remains online and synchronised with the network. To alleviate this assumption, customers can hire a third party watching service (a.k.a Watchtower) to watch the blockchain and respond to channel breaches on their behalf. 

At a high level, the client sends an encrypted justice transaction alongside a transaction locator to the WatchTower. Both the encryption key and the transaction locator are derived from the breach transaction id, meaning that the WatchTower will be able to decrypt the justice transaction only after the corresponding breach is seen on the blockchain. Therefore, the WatchTower does not learn any information about the client's channel unless there is a channel breach (channel-privacy).

Due to replace-by-revocation Lightning channels, the client should send data to the WatchTower for every new update in the channel, otherwise the WatchTower may not be able to respond to specific breaches. 

Finally, optional QoS can be offered by the WatchTower to provide stronger guarantees to the client, such as a signed receipt for every new job. The rationale for the receipt is to build an _accountable_ WatchTower as the customer can later use it as publicly verifiable evidence if the WatchTower fails to protect them.

The scope of this document includes: 

- A protocol for client/server communication.
- How to build appointments for the WatchTower, including key/locator derivation and data encryption.
- A format for the signed receipt. 

The scope of this bolt does not include: 

 - A payment protocol between the customer and WatchTower. 
 - WatchTower server discovery.
 

## Table of Contents 
* [WatchTower discovery](#watchtower-discovery)
* [WatchTower services](#watchtower-discovery)
	* [Basic Service](#basic-service)
	* [Quality of Service](#quality-of-service)
* [Sending and receiving appointments](#sending-and-receiving-appointments)
 	* [The `appointment` message](#the-appointment-message)
 	* [The `appointment_accepted` message](#the-appointment_accepted-message)
 	* [The `appointment_rejected` message](#the-appointment_rejected-message)
* [Quality of Service data](#quality-of-service-data)
	* [`accountability`](#accountability)
* [Transaction Locator and Encryption Key](#transaction-locator-and-encryption-key)
* [Encryption Algorithms and Parameters](#encryption-algorithms-and-parameters)
* [Payment Modes](#payment-modes)
* [No compression of justice transaction](#no-compression-of-justice-transaction)

## WatchTower discovery
At this point we're leaving the client/server connection to be protocol agnostic. How the Lightning node finds the WatchTower or how the WatchTower announces their presence and services provided is not specified.

Therefore, we are assuming that the client and server are connected and that the client have learnt what Quality of Service (`qos`) the tower is offering. Moreover, we asume that the client has an authentication token `aut_token` to prove he's entitled to use the service if required.

## WatchTower services

### Basic Service
The customer can hire the WatchTower to watch for breaches on the blockchain and relay a justice transaction on their behalf. The customer receives an acknowledgement when the WatchTower has accepted the job, but the hiring protocol does guarantee the transaction inclusion.

### Quality of Service
Quality of Service (`qos`) builds on top of the basic service provided by a tower and it's optionally provided. Different kinds of QoS can be offered by the tower.

For now we are defining a single type of `qos`: `accountability`.

#### `accountability`

A WatchTower provides a signed receipt to the customer. This is considered reputational accountability as the customer has publicly verifiable cryptographic evidence the WatchTower was hired. The receipt can be used to prove the WatchTower did not relay the justice transaction on their behalf and/or request a refund.

## Sending and receiving appointments

Once the client is aware of the services provided by the server, the former can start sending appointments to the latter.

		+-------+                                    +-------+
		|   A   |--(1)---      appointment      ---->|   B   |
		|       |<-(2)---   accepted/rejected   -----|       |
		+-------+                                    +-------+
		
		- where node A is 'client' and node B is 'server'

### The `appointment` message

This message contains all the information regarding the appointment that the client wants to arrange with the server.

1. type: ? (`appointment`)
2. data:
   * [`16*byte`:`locator`]
   * [`u64 `:`start_block`]
   * [`u64 `:`end_block`]
   * [`u16`: `encrypted_blob_len`
   * [`encrypted_blob_len*byte`:`encrypted_blob`]
   * [`u16`:`cipher`]
   * [`u16`: `auth_token_len`]
   * [`auth_token_len*bytes`: `auth_token`]
   * [`u16`: `qos_len`]
   * [`qos_len*byte`: `qos_data`]

#### Requirements

The sending node:

* MUST set `locator` as specified in [Transaction Locator and Encryption Key](#transaction-locator-and-encryption-key).
* MUST set `start_block` the current chain tip height.
* MUST set `end_block` to the block height at which he requests the server to stop watching for breaches.
* MUST set `encrypted_blob` to the encryption of the `justice_transaction` as specified in [Transaction Locator and Encryption Key](#transaction-locator-and-encryption-key).
* MUST set `cipher` to the cipher used to create the `encrypted_blob`.
* MAY send an empty `auth_token` field.
* MUST set `auth_token_len` to the length of `auth_token`
* MAY send an empty `qos_data` field.
* if `qos_data` is not empty:
	*  MUST set `qos_data` according to [Quality of Service data](#quality-of-service-data).
* MUST set `qos_len` equal to the length of `qos_data`.

The receiving node:

The receiving node MUST reject the appointment if:
* Authentication is required and `auth_token` is not provided.
* Authentication is required and `auth_token` is invalid.
* `locator` is not a `16-byte` value.
* `start_block` is further than one block behind the current chain tip.
* `start_block` is further than one block ahead the current chain tip.
* `encrypted_blob` has unreasonable size.
* `cipher` is not among the ones he implements.

The receiving node SHOULD reject the appointment if:

* `end_block` is too far away in the future.

The receiving node MUST: 

* truncate the remainder of the package to `qos_len`.
* if `qos_len` is not 0:
	* process `qos_data` according to [Quality of Service data](#quality-of-service-data).

The receiving node MAY accept the appointment otherwise.

#### Rationale

WatchTowers may work in different modes (e.g. altruistic vs non-altruistic). In some of those modes, proof of payment may be required for the WatchTower to perform provide the service. `auth_token` is used to decide wether the user is entitled to use the service or not in the cases it may be required. Notice that the tokens do not need to be linked to any kind of identity but confirm that the payment has been performed.

The transaction `locator` can be deterministically computed by both the client and the server. Locators of wrong size are therefore invalid.

`start_block` can be either one block ahead or behind the tower tip due to network delays. A tower must not accept appointments arbitrarily ahead or behind the current tip since it could ease DoS vectors. A `start_block` long behind would force the tower to rescan block data for those appointments instead of watching block by block. On the other hand, a `start_time` long ahead would imply storing information way before it being needed.

Regarding the `end_block`, too far away is a subjective concept. The further away a tower accepts appointment ends, the higher the potential storage requirements may be, and the easier (and cheaper) would it be to DoS.

The `encrypted_blob` should have been encrypted using `cipher`. Block ciphers have a size multiple of the block length, which depends on the key size. Therefore the `encrypted_blob` have to be at least as big as:

`cipher_block_size * ceil(minimum_viable_transaction_size / cipher_block_size)`

And at most as big as:

`cipher_block_size * ceil(maximum_viable_transaction_size / cipher_block_size`) 

`minimum_viable_transaction_size` and `maximum_viable_transaction_size` refer to the minimum/maximum size required to create a valid transaction. Accepting `encrypted_blob` outside those boundaries will ease DoS attacks on the server.

The client should have learn about the `ciphers` implemented by the WatchTower and the `qos` that the tower is offering during the peer discovery.

A tower must not accept appointments using a cipher it does not implement, otherwise the decryption of the `encrypted_blolb` will not be possible.

`qos` is optional and can include multiple services.
	
### The `appointment_accepted` message

This message contains information about the acceptance of an appointment by the WatchTower.

1. type: ? (`appointment_accepted `)
2. data:
   * [`16*byte `:`locator`]
   * [`u16`: `qos_len`]
	* [`qos_len*byte`: `qos_data`]

The sending node:

* MUST receive `appointment` before sending an `appointment_accepted` message.
* MUST set the `locator` to match the one received in `appointment`.
* if `qos_data` was requested in `appointment`:
	*  MUST set `qos_data` according to [Quality of Service data](#quality-of-service-data).
* MUST set `qos_len` equal to the length of `qos_data`.

The receiving node:

* MUST fail the connection  if `locator` does not match any of the previously sent to the WatchTower:

* if `qos` was requested in `appointment`:
	* MUST fail the connection if `qos_len` is 0.
	* MUST process `qos_data` according to [Quality of Service data](#quality-of-service-data).

### The `appointment_rejected` message

This message contains information about the rejection of an appointment by the WatchTower.

1. type: ? (`appointment_rejected `)
2. data:
   * [`16*byte `:`locator`]
   * [`u16`: `rcode`]
   * [`u16`: `reason_len`
   * [`reason_len*byte`: `reason`]

The sending node:

* MUST receive `appointment` before sending an `appointment_rejected` message.
* MUST set the `locator` to match the one received in `appointment`.
* MUST set `rcode` to the rejection code.
* MAY set and empty `reason` field.
* MUST set `reason_len` to length of `reason`.

#### Rationale

The `appointment_rejected` message follows the approach taken by the `error` message defined in [BOLT#1](https://github.com/lightningnetwork/lightning-rfc/blob/master/01-messaging.md#the-error-message): error codes are mandatory, whereas reasons are optional and implementation dependant.

## Quality of Service data

`qos_data` is a list where each field specifies they type and associated data of the offered/requested `qos`. The format is defined as follows:

* [`u16`: `qos_type`]
* [`u16`: `data_len`]
* [`data_len*byte`: `data`]

So far, only `accountability` is defined.

### `accountability`

The accountability `qos` defines a pair `qos_data` blobs, associated to a pair of messages: The first one is `customer_evidence` and it is provided by the `client` in the `appointment` message. The second one it is `tower_evidence`, and is provided by the WatchTower in the `appointment_accepted` message.

#### `customer_evidence`

The format for the `customer_evidence` is defined as follows:

1. type: ? (`customer_evidence`)
2. data:  
	* [`u64 `:`dispute_delta`]
	* [`u64`: `transaction_size`]
	* [`u64`: `transaction_fee`]

If `accountability` is being requested, the sending node:
	
* MUST set `dispute_delta` to the CLTV value specified in the `commitment_transaction`.
* MUST set `transaction_size` to the size of the serialized `justice_transaction`, in bytes.
* MUST set `transaction_fee` to the fee set in the `justice_transaction`, in satoshis.
* MUST set the `customer_signature_algorithm` to one of the signature algorithms supported by the tower.
* MUST set `customer_signature` to the signature of the appointment using `op_customer_signature_algorithm`.
* MUST set `customer_public_key` to the public key that matches the private key used to create `op_customer_signature`.

If `accountability` is being offered, the receiving node:

* MUST compute the `customer_signature` verification using `customer_public_key`.
* SHOULD compute the `fee_rate` set in the `justice_tx` using `transaction_size` and `transaction_fee`.

* MUST reject the appointment if:
	* Any of the fields is missing.
	* `transaction_size` is unreasonable.
	* `customer_signature_algorithm` does not match any of the supported signing algorithms.
	* `customer_signature` cannot be verified using `customer_public_key`.

* SHOULD reject the appointment if:
	* `dispute_delta` is too small.
	* `fee_rate` is too low.

If `accountability` is NOT being offered:

* The receiving node MUST reject the appointment.

Otherwise:

* The receiving node SHOULD accept the appointment.

#### Rationale

The concept of too small for `dispute_delta` is subjective. The `dispute_delta` defines the time (in blocks) that the tower has to respond after a breach is seen. The smallest the value, the more the server risks to fail the appointment.

`transaction_size` and `transaction_fee` help the WatchTower to decide on the likelihood of an appointment being fulfilled. Appointments with `fee_rate` too low may be rejected by the WatchTower. While a customer can always fake this values, it should break ToS between the client and the server and, therefore, release the WatchTower of any liability.

If `accountability` is not being offered, it makes not much sense accepting appointments that request it. If the tower accepts an appointment requesting `accountability`, it should be enforced or refunded. Generally, this is trying to allow a reputationally accountable watching service. The signed job from the customer provides an explicit acknowledgement of the transaction details that is important for the WatchTower to decide whether it can accept them. If the decrypted justice transaction does not satisfy the signed job (e.g. fee too low), then the WatchTower is not obliged to fulfil the appointment. 

#### `tower_evidence`

The format for the `tower_evidence` is defined as follows:

1. type: ? (`tower_evidence`)
2. data:  
	* [`u16 `:`receipt_length`]
	* [`receipt_length `: `receipt`]
	* [`u16`: `wt_signature_algorithm`]
	* [`u16`: `wt_signature_len`
	* [`wt_signature_len*byte`: `wt_signature`]
	* [`u16`: `wt_public_key_len`]
	* [`wt_public_key_len*byte`: `wt_public_key`]

The sending node:

* MUST set `receipt` to a receipt built according to 	[Receipt-Format](#receipt-format)
* MUST set `wt_signature_algorithm` to one of the signature algorithms he has announced.
* MUST set `wt_signature` to the signature of the appointment using `wt_signature_algorithm`.
* MUST set `wt_public_key` to the public key that matches the private key used to create `wt_signature`.

The receiving node:

* MUST compute the `wt_signature` verification using `wt_public_key`.

* MUST fail the connection if:
	* Any of the fields is missing.
	* `receipt` does not matches the format specified at 	[Receipt-Format](#receipt-format)
	* `receipt` fields do not match the ones sent in the `appointment` message.
	* `wt_signature_algorithm` does not match any of the ones offered by the WatchTower
	* `wt_signature` cannot be verified using `wt_public_key`.

#### Receipt Format 

The server (WatchTower) MUST create the receipt as containing the following infiormation:

	txlocator
	start_block
	end_block
	dispute_delta
	encrypted_blob
	transaction_size
	transaction_fee
	cipher
	customer_public_key
	customer_signature
	wt_public_key
	

#### Rationale

We assume the server has a well-known public key for the WatchTower. 

The receipt contains, mainly, the information provided by the user. The WatchTower will need to sign the receipt to provide evidence of agreement.

The `customer_signature` is included in the receipt to link both the client request and the server response. Otherwise a client could sign random data and claim to have send it to the tower. In the same way, a signed receipt protects the user from false claims from the tower.


#### Receipt serialization and signature

[FIXME: TBD]

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
	    
## Payment modes 

Although this BOLT does not enforce any specific payment method to be adopted, it is worth mentioning the three most common ones:

**On-chain bounty**. An additional output is created in the justice transaction that will reward the WatchTower. 

**Micropayments**. A small payment is sent to the WatchTower for every new job (e.g. over the lightning network)

**Subscription**. WatchTower is periodically rewarded / paid for their service to the customer. (e.g. over the lightning network or fiat subscription). 

Both micropayments and subscriptions are favourable for a WatchTower. The on-chain bounty approach is not ideal for a watching network, it lets the customer hire N WatchTowers (O(N) storage for each tower) and only one WatchTower will be rewarded upon collecting the bounty. On top of that, the onchain bounty allows a network-wise DoS attack for free.

## No compression of justice transaction 

The storage requirements for a WatchTower can be reduced (linearly) by implementing [shachain](https://github.com/rustyrussell/ccan/blob/master/ccan/crypto/shachain/design.txt), therefore storing the parts required to build the transaction and the corresponding signing key instead of the full transaction. For now, we have decided to keep the hiring protocol simple. Storage is relatively cheap and we can revisit this standard if it becomes a problem. 

## FIXMES

- Define a proper tower discovery
- Define authentication mechanism (macaroons maybe?)
- None of the message types have been defined (they have been left with ?)
- Define receipt serialization format
- `qos_type` can be defined by ranges, in the same way that error messages are. In that way a range of values can belong to a specific `qos`
- Discuss wether to extend it with shachain

## Acknowledgments


## Authors

Patrick McCorry, Sergi Delgado, PISA Research. 

![Creative Commons License](https://i.creativecommons.org/l/by/4.0/88x31.png "License CC-BY")
<br>
This work is licensed under a [Creative Commons Attribution 4.0 International License](http://creativecommons.org/licenses/by/4.0/).
