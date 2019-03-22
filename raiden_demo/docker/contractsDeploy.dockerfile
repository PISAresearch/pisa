FROM python:3.6.8-stretch
WORKDIR /usr/raiden

RUN ["git", "clone", "https://github.com/pisaresearch/raiden-contracts.git"]

WORKDIR /usr/raiden/raiden-contracts

# checkout the red eyes tag
RUN ["git", "checkout", "settlement-min-5"]

# install a specific version of solc
RUN curl -o /usr/bin/solc -fL https://github.com/ethereum/solidity/releases/download/v0.4.24/solc-static-linux \
    && chmod u+x /usr/bin/solc
# compile contracts and install dependencies
RUN ["make", "compile_contracts"]
RUN ["make", "install"]
RUN pip install -r requirements-dev.txt

RUN ["apt", "update"]
RUN ["apt", "-y", "install", "expect"]

COPY "${PWD}/raiden_deploy_script.exp" "/home/raiden_deploy_script.exp"

# deploy contracts to local network
ENTRYPOINT ["expect", "/home/raiden_deploy_script.exp"]