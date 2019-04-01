FROM parity/parity:v2.4.1

# copy the chain data and the test data
COPY --chown=parity "${PWD}/chainData" "/home/parity/.local/share/io.parity.ethereum"
COPY --chown=parity "${PWD}/test-chain.json/" "/home/test-chain.json"

# start parity
ENTRYPOINT ["parity"]