[![codecov](https://codecov.io/gh/PISAresearch/pisa/branch/master/graph/badge.svg)](https://codecov.io/gh/PISAresearch/pisa)



# Prerequisites for this tutorial:

Install node and npm:

```
npm v6.9.0
node v11.10.1
npm install -g ts-node
```

If you run into any problems, we recommend a node version manager:

```
https://github.com/nvm-sh/nvm
```

The raiden tests require parity (optional):

```
bash <(curl https://get.parity.io -L) -r stable
```

Download the source-code from the github:

```
git clone https://github.com/PISAresearch/pisa.git
```

Turn on a local instance of Ganache (tip: you may need to change port to 8545)

```
Guide to install & run https://hackernoon.com/ethereum-development-walkthrough-part-2-truffle-ganache-geth-and-mist-8d6320e12269
```

You will need to install node modules (in /pisa folder):

```
npm ci
npm install
```

Installing bunyan will provide slightly nicer logs:

```
npm install -g bunyan
```

# PISA developer test suite

There are three tests:

```
npm run test
npm run test-raiden
npm run test-integration
```

Finally you can run the developer test suite:

```
npm run start-dev | bunyan
```

# PISA using docker

To run PISA as a docker image, you first need to run Ganache in docker:

```
docker run -p 8545:8545 trufflesuite/ganache-cli:latest
```

Next we need to make three folders in the /pisa folder:

```
mkdir deployment
cd deployment
mkdir logs
mkdir db
```

Next we need to make a config in /pisa/deployment:

```
vi config.json
```

Paste in the following JSON:

```
{
    "dbDir": "db",
    "hostName": "0.0.0.0",
    "hostPort": 3000,
    "jsonRpcUrl": "http://10.1.20.50:8545",
    "loglevel": "info",
    "responderKey": "<private key for responder>",
    "receiptKey": "<private key for receipt signing>"
}
```

The responderKey and receiptKey must be filled in. For testing, *we recommend using a private key from the Ganache* instance. (i.e. Check the terminal output, there will be a list of private keys. Just pick your favourite).

Get latest PISA docker:

```
docker pull pisaresearch/pisa:latest
```

Run PISA:

```
docker run -p 3000:3000 --volume ${PWD}/logs:/usr/pisa/logs --volume ${PWD}/config.json:/usr/pisa/build/src/config.json --volume ${PWD}/db:/usr/pisa/db --name pisa pisaresearch/pisa:latest
```

To access the PISA docker container:

```
docker exec -it pisa /bin/bash
```

To kill the process, you can run:

```
get commands
```

If you run into any docker container issues, you can just delete the existing PISA container and try again:

```
docker container rm pisa
```
