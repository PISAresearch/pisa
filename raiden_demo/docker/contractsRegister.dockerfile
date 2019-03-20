FROM python:3.6.8-stretch
WORKDIR /usr/raiden

RUN ["git", "clone", "https://github.com/raiden-network/raiden-contracts.git"]

WORKDIR /usr/raiden/raiden-contracts

# checkout the red eyes tag
RUN ["git", "checkout", "fac73623d5b92b7c070fdde2b446648ec9117474"]

# install a specific version of solc
RUN curl -o /usr/bin/solc -fL https://github.com/ethereum/solidity/releases/download/v0.4.24/solc-static-linux \
    && chmod u+x /usr/bin/solc
# compile contracts and install dependencies
RUN ["make", "compile_contracts"]
RUN ["make", "install"]
RUN pip install -r requirements-dev.txt

# deploy contracts to local network
ENTRYPOINT ["python", "-m", "raiden_contracts.deploy", "--help""]