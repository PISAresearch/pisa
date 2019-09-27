import { PisaService } from "./service";
import { ethers } from "ethers";
import { PisaConfigManager, IArgConfig } from "./dataEntities/config";
import { validateProvider, getJsonRPCProvider } from "./utils/ethers";
import logger, {initialise, LogLevelInfo } from "./logger";
import levelup, { LevelUp } from "levelup";
import encodingDown from "encoding-down";
import leveldown from "leveldown";

let config: IArgConfig;
try {
    config = PisaConfigManager.getConfig();
} catch (doh) {
    const err = doh as Error;
    console.error(err.message);
    process.exit(1);
}

async function startUp() {
    initialise(LogLevelInfo.tryParse(config.loglevel)!, config.instanceName);

    const provider = getJsonRPCProvider(config.jsonRpcUrl);
    await validateProvider(provider);

    const watcherWallet = new ethers.Wallet(config.responderKey, provider);
    const receiptSigner = new ethers.Wallet(config.receiptKey);
    const db = levelup(encodingDown(leveldown(config.dbDir), { valueEncoding: "json" }));
    const nonce = await provider.getTransactionCount(watcherWallet.address, "pending");

    // start the pisa service
    const service = new PisaService(config, provider, watcherWallet, nonce, provider.network.chainId, receiptSigner, db);
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

startUp().catch((doh: Error) => logger.error(doh));
