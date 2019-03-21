#! /bin/bash
endpoint=$1
secret=$2
tokennetwork=$3

raiden --gas-price fast --accept-disclaimer --network-id ropsten --eth-rpc-endpoint http://localhost:8545 --address 0xF0AFBed24d88cE4CB12828984Bb10d2f1ad0e185 --api-address http://0.0.0.0:6660 --password-file ${PWD}/test-accounts/password--f0afbed24d88ce4cb12828984bb10d2f1ad0e185.txt  --no-sync-check --disable-debug-logfile --tokennetwork-registry-contract-address $tokennetwork --secret-registry-contract-address $secret --endpoint-registry-contract-address $endpoint &

raiden --gas-price fast --accept-disclaimer --network-id ropsten --eth-rpc-endpoint http://localhost:8545 --address 0xB457aed7A81D0428Fe54087af80099FcF27E2782 --api-address http://0.0.0.0:6661 --password-file ${PWD}/test-accounts/password--b457aed7a81d0428fe54087af80099fcf27e2782.txt  --no-sync-check --disable-debug-logfile --tokennetwork-registry-contract-address $tokennetwork --secret-registry-contract-address $secret --endpoint-registry-contract-address $endpoint