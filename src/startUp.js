"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const service_1 = require("./service");
const ethers_1 = require("ethers");
const watcher_1 = require("./watcher");
const inspector_1 = require("./inspector");
const config = require("./config.json");
const provider = new ethers_1.ethers.providers.JsonRpcProvider(config.jsonRpcUrl);
provider.pollingInterval = 100;
const watcherWallet = new ethers_1.ethers.Wallet(config.watcherKey, provider);
const watcher = new watcher_1.KitsuneWatcher(provider, watcherWallet);
const inspector = new inspector_1.KitsuneInspector(10, provider);
// start the pisa service
const service = new service_1.PisaService(config.host.name, config.host.port, inspector, watcher);
// wait for a stop signal
waitForStop();
function waitForStop() {
    const stdin = process.stdin;
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
