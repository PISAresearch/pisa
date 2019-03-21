import { ethers } from "ethers";
let privateKey = "0xc364a5ea32a4c267263e99ddda36e05bcb0e5724601c57d6504cccb68e1fe6ae";

const argv = require('yargs')
    .scriptName("autominer")
    .usage('$0 [args]')
    .demandOption(['period'])
    .describe('period', 'Time in milliseconds seconds between mining')
    .demandOption(['jsonrpcurl'])
    .describe('jsonrpcurl', 'Location of the ethereum node to automine on')
    .help()
    .argv;

let provider = new ethers.providers.JsonRpcProvider(argv.jsonrpcurl);
let wallet = new ethers.Wallet(privateKey, provider);

let tick = async () => {
    await wallet.sendTransaction({ chainId: 3, to: "0x0000000000000000000000000000000000000000", value: 1 });
};

let start = (period: number) => {
    setTimeout(async () => {
        await tick();
        start(period);
    }, period);
};

start(argv.period);
