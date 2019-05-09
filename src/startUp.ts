import { PisaService } from "./service";
import { ethers } from "ethers";
import config from "./dataEntities/config";
import { getJsonRPCProvider } from "./provider";
import { withDelay } from "./utils/ethers";
import levelup, { LevelUp } from "levelup";
import encodingDown from "encoding-down";
import leveldown from "leveldown";

const argv = require("yargs")
    .scriptName("pisa")
    .usage("$0 [args]")
    .describe("json-rpc-url", "Overrides jsonRpcUrl from config.json.")
    .describe("host-name", "Overrides host.name from config.json")
    .describe("host-port", "Overrides host.porg from config.json")
    .option("responder-key", {
        description: "Overrides responderKey from config.json",
        string: true
    })
    .option("db-dir", {
        description: "Directory to hold the database",
        string: true
    })
    .option("rate-limit-user-windowms", {
        description: "Overrides apiEndPoint.ratePerUser.windowMs from config.json",
        number: true
    })
    .option("rate-limit-user-max", {
        description: "Overrides apiEndPoint.ratePerUser.max from config.json",
        number: true
    })
    .option("rate-limit-user-message", {
        description: "Overrides apiEndPoint.ratePerUser.message from config.json",
        string: true
    })
    .option("rate-limit-global-windowms", {
        description: "Overrides apiEndPoint.rateGlobal.windowMs from config.json",
        number: true
    })
    .option("rate-limit-global-max", {
        description: "Overrides apiEndPoint.rateGlobal.max from config.json",
        number: true
    })
    .option("rate-limit-global-message", {
        description: "Overrides apiEndPoint.rateGlobal.message from config.json",
        string: true
    })
    .help().argv;

//Override config.json if arguments are provided
if (argv.jsonRpcUrl) config.jsonRpcUrl = argv.jsonRpcUrl;
if (argv.hostName) config.host.name = argv.hostName;
if (argv.hostPort) config.host.port = argv.hostPort;
if (argv.responderKey) config.responderKey = argv.responderKey;
if (argv.dbDir) config.dbDir = argv.dbDir;

if ((argv.rateLimitUserWindowms && !argv.rateLimitUserMax) || (!argv.rateLimitUserWindowms && argv.rateLimitUserMax)) {
    console.error("Options 'rate-limit-user-windowms' and 'rate-limit-user-max' must be provided together.");
    process.exit(1);
}
if (argv.rateLimitUserWindowms || argv.rateLimitUserMax || argv.rateLimitUserMessage) {
    config.apiEndpoint = config.apiEndpoint || {};
    config.apiEndpoint.ratePerUser = {
        windowMs:
            argv.rateLimitUserWindowms || (config.apiEndpoint.ratePerUser && config.apiEndpoint.ratePerUser.windowMs),
        max: argv.rateLimitUserMax || (config.apiEndpoint.ratePerUser && config.apiEndpoint.ratePerUser.max),
        message: argv.rateLimitUserMessage || (config.apiEndpoint.ratePerUser && config.apiEndpoint.ratePerUser.message)
    };
}
if (
    (argv.rateLimitGlobalWindowms && !argv.rateLimitGlobalMax) ||
    (!argv.rateLimitGlobalWindowms && argv.rateLimitGlobalMax)
) {
    console.error("Options 'rate-limit-global-windowms' and 'rate-limit-global-max' must be provided together.");
    process.exit(1);
}
if (argv.rateLimitGlobalWindowms || argv.rateLimitGlobalMax || argv.rateLimitGlobalMessage) {
    config.apiEndpoint = config.apiEndpoint || {};
    config.apiEndpoint.rateGlobal = {
        windowMs:
            argv.rateLimitGlobalWindowms || (config.apiEndpoint.rateGlobal && config.apiEndpoint.rateGlobal.windowMs),
        max: argv.rateLimitGlobalMax || (config.apiEndpoint.rateGlobal && config.apiEndpoint.rateGlobal.max),
        message: argv.rateLimitGlobalMessage || (config.apiEndpoint.rateGlobal && config.apiEndpoint.rateGlobal.message)
    };
}

let db: LevelUp<encodingDown<string, any>>;

Promise.all([getJsonRPCProvider(config.jsonRpcUrl), getJsonRPCProvider(config.jsonRpcUrl)]).then(
    providers => {
        const provider = providers[0];
        const delayedProvider = providers[1];
        withDelay(delayedProvider, 2);

        const watcherWallet = new ethers.Wallet(config.responderKey, provider);

        // intialise the db
        db = levelup(encodingDown(leveldown(config.dbDir), { valueEncoding: "json" }));

        // start the pisa service
        const service = new PisaService(
            config.host.name,
            config.host.port,
            provider,
            watcherWallet,
            delayedProvider,
            db,
            config.apiEndpoint
        );
        service.start().then(a => {
            // wait for a stop signal
            waitForStop(service);
        });
    },
    err => {
        console.error(err);
        if (db.isOpen)
            db.close().then(
                () => process.exit(1),
                () => {
                    console.error("db failed to close");
                    process.exit(1);
                }
            );
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
        stdin.on("data", async key => {
            // ctrl-c ( end of text )
            if (key === "\u0003") {
                await Promise.all([
                    // stop the pisa service
                    service.stop(),
                    // shut the db
                    db.close()
                ]);

                // exit the process
                process.exit();
            }
            // otherwise write the key to stdout all normal like
            process.stdout.write(key);
        });
    }
}
