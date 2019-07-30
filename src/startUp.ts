import { PisaService } from "./service";
import { ethers } from "ethers";
import jsonConfig, { IArgConfig, ConfigManager } from "./dataEntities/config";
import { validateProvider, getJsonRPCProvider } from "./utils/ethers";
import logger, { setLogLevel, LogLevel, LogLevelInfo } from "./logger";
import levelup, { LevelUp } from "levelup";
import encodingDown from "encoding-down";
import leveldown from "leveldown";

const configManager = new ConfigManager(ConfigManager.PisaConfigProperties);
const commandLineConfig = configManager.fromCommandLineArgs(process.argv);

function checkArgs(args: IArgConfig) {
    if (
        (args.rateLimitUserWindowMs && !args.rateLimitUserMax) ||
        (!args.rateLimitUserWindowMs && args.rateLimitUserMax)
    ) {
        console.error("Options 'rate-limit-user-windowms' and 'rate-limit-user-max' must be provided together.");
        process.exit(1);
    }

    if (
        (commandLineConfig.rateLimitGlobalWindowMs && !commandLineConfig.rateLimitGlobalMax) ||
        (!commandLineConfig.rateLimitGlobalWindowMs && commandLineConfig.rateLimitGlobalMax)
    ) {
        console.error("Options 'rate-limit-global-windowms' and 'rate-limit-global-max' must be provided together.");
        process.exit(1);
    }
}

// Validates the 'loglevel' argument and returns the appropriate LogLevelInfo instance
function checkLogLevel(logLevel: string): LogLevelInfo {
    const logLevelInfo = LogLevelInfo.tryParse(logLevel);
    if (!logLevelInfo) {
        console.error("Option 'loglevel' can only be one of the following: " + Object.values(LogLevel).join(", "));
        return process.exit(1); // never returns
    }
    return logLevelInfo;
}

async function startUp() {
    checkArgs(commandLineConfig);
    const config = Object.assign(jsonConfig, commandLineConfig);

    const logLevelInfo = checkLogLevel(config.loglevel);
    setLogLevel(logLevelInfo);

    const provider = getJsonRPCProvider(config.jsonRpcUrl);
    await validateProvider(provider);

    const watcherWallet = new ethers.Wallet(config.responderKey, provider);
    const receiptSigner = new ethers.Wallet(config.receiptKey);
    const db = levelup(encodingDown(leveldown(config.dbDir), { valueEncoding: "json" }));

    // start the pisa service
    const service = new PisaService(config, provider, watcherWallet, receiptSigner, db);
    service.start();

    // listen for stop events
    process.on("SIGTERM", async () => await stop(service, db));
    // CTRL-C
    process.on("SIGINT", async () => await stop(service, db));
}

async function stop(service: PisaService, db: LevelUp<encodingDown<string, any>>) {
    await Promise.all([
        // stop the pisa service
        service.stop(),
        // shut the db
        db.close()
    ]);

    // exit the process
    process.exit(0);
}

startUp().catch((doh: Error) => logger.error(doh.stack!));
