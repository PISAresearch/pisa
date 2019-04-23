import { PisaService } from "./service";
import { ethers } from "ethers";
import config from "./dataEntities/config";
import { getJsonRPCProvider } from "./provider";
import { withDelay } from "./utils/ethers";

const argv = require('yargs')
    .scriptName("pisa")
    .usage('$0 [args]')
    .describe('json-rpc-url', 'Overrides jsonRpcUrl from config.json.')
    .describe('host-name', 'Overrides host.name from config.json')
    .describe('host-port', 'Overrides host.porg from config.json')
    .option('responder-key', {
        description: 'Overrides responderKey from config.json',
        string: true
    })
    .help()
    .argv;

//Override config.json if arguments are provided
if (argv.jsonRpcUrl) config.jsonRpcUrl = argv.jsonRpcUrl;
if (argv.hostName) config.host.name = argv.hostName;
if (argv.hostPort) config.host.port = argv.hostPort;
if (argv.responderKey) config.responderKey = argv.responderKey;

Promise.all([getJsonRPCProvider(config.jsonRpcUrl), getJsonRPCProvider(config.jsonRpcUrl)]).then(
    providers => {
        const provider = providers[0];
        const delayedProvider = providers[1];
        withDelay(delayedProvider, 2);

        const watcherWallet = new ethers.Wallet(config.responderKey, provider);

        // start the pisa service
        const service = new PisaService(config.host.name, config.host.port, provider, watcherWallet, delayedProvider);

        // wait for a stop signal
        waitForStop(service);
    },
    err => {
        console.error(err);
        process.exit(1);
    }
);

function waitForStop(service: PisaService) {
    const stdin = process.stdin;
    if (stdin.setRawMode) {
        // without this, we would only get streams once enter is pressed
        stdin.setRawMode(true);

        // resume stdin in the parent process (node app won't quit all by itself
        // unless an error or process.exit() happens)
        stdin.resume();
        stdin.setEncoding("utf8");
        stdin.on("data", key => {
            // ctrl-c ( end of text )
            if (key === "\u0003") {
                // stop the pisa service
                service.stop();
                // exit the process
                process.exit();
            }
            // otherwise write the key to stdout all normal like
            process.stdout.write(key);
        });
    }
}
