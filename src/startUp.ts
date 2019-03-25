import { PisaService } from "./service";
import { ethers } from "ethers";
import config from "./dataEntities/config";
import { KitsuneWatcher } from "./watcher";
import { KitsuneInspector } from "./inspector";
import { getJsonRPCProvider } from "./provider";

const argv = require('yargs')
    .scriptName("pisa")
    .usage('$0 [args]')
    .describe('json-rpc-url', 'Overrides jsonRpcUrl from config.json.')
    .describe('host-name', 'Overrides host.name from config.json')
    .describe('host-port', 'Overrides host.porg from config.json')
    .option('watcher-key', {
        description: 'Overrides watcherKey from config.json',
        string: true
    })
    .help()
    .argv;

//Override config.json if arguments are provided
if (argv.jsonRpcUrl) config.jsonRpcUrl = argv.jsonRpcUrl;
if (argv.hostName) config.host.name = argv.hostName;
if (argv.hostPort) config.host.port = argv.hostPort;
if (argv.watcherKey) config.watcherKey = argv.watcherKey;

getJsonRPCProvider().then(
    provider => {
        const watcherWallet = new ethers.Wallet(config.watcherKey, provider);
        const watcher = new KitsuneWatcher(provider, watcherWallet);
        // TODO: need test/production settings for the inspector
        const inspector = new KitsuneInspector(4, provider);

        // start the pisa service
        const service = new PisaService(config.host.name, config.host.port, inspector, watcher);

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
