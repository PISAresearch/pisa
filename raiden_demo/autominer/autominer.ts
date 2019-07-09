import { ethers } from "ethers";
let privateKey = "0x3ebe90153ac377735aacad7d95b0a37809dad3dc0c5e49752b67eb61298c3114";

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
