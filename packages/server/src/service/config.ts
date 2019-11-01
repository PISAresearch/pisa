import config from "../config.json";
import yargs from "yargs";
import { LogLevel, LogLevelInfo } from "@pisa/utils";

export interface IArgConfig {
    jsonRpcUrl: string;
    hostName: string;
    hostPort: number;
    responderKey: string;
    receiptKey: string;
    loglevel: string;
    dbDir: string;
    watcherResponseConfirmations?: number;
    maximumReorgLimit?: number;
    pisaContractAddress: string;
    instanceName: string;

    rateLimitUserWindowMs?: number;
    rateLimitUserMax?: number;
    rateLimitUserMessage?: string;
    rateLimitGlobalWindowMs?: number;
    rateLimitGlobalMax?: number;
    rateLimitGlobalMessage?: string;
}

class ConfigProperty {
    constructor(public readonly commandLineName: string, public readonly valueGetter: (config: IArgConfig) => any, public readonly yargConfig: any) {}
}

/**
 * Enables parsing and serialising of config objects
 */
export class ConfigManager {
    constructor(private readonly properties: ConfigProperty[]) {}

    public fromCommandLineArgs(argv: string[]) {
        // initialise the yargs
        let commandLineConfig = yargs
            .scriptName("pisa")
            .usage("$0 [args]")
            .help();

        // add each of the props
        this.properties.forEach(p => (commandLineConfig = commandLineConfig.option(p.commandLineName, p.yargConfig)));

        return (commandLineConfig.parse(argv) as any) as IArgConfig;
    }

    private notEmpty<TValue>(value: TValue | null | undefined): value is TValue {
        return value !== null && value !== undefined;
    }

    public toCommandLineArgs(config: IArgConfig): string[] {
        return this.properties
            .map(p => {
                const value = p.valueGetter(config);
                return value ? [`--${p.commandLineName}`, `${value}`] : null;
            })
            .filter(this.notEmpty)
            .reduce((a, b) => a.concat(b));
    }

    /**
     * Gets the current config settings, looking for both a configuration file and command line arguments.
     * Command line arguments take precedence where present.
     * Returns an error message of the command line args could not be parsed.
     */
    public getConfig() {
        const fromCommandLine = this.fromCommandLineArgs(process.argv);
        const returnConfig = Object.assign(config, fromCommandLine);
        this.checkLogLevel(returnConfig.loglevel);
        this.checkRateLimits(returnConfig);
        return returnConfig;
    }

    private checkLogLevel(logLevel: string) {
        const logLevelInfo = LogLevelInfo.tryParse(logLevel);
        if (!logLevelInfo) throw new Error("Option 'loglevel' can only be one of the following: " + Object.values(LogLevel).join(", "));
    }

    private checkRateLimits(args: IArgConfig) {
        if ((args.rateLimitUserWindowMs && !args.rateLimitUserMax) || (!args.rateLimitUserWindowMs && args.rateLimitUserMax)) {
            throw new Error("Options 'rate-limit-user-windowms' and 'rate-limit-user-max' must be provided together.");
        }

        if ((args.rateLimitGlobalWindowMs && !args.rateLimitGlobalMax) || (!args.rateLimitGlobalWindowMs && args.rateLimitGlobalMax)) {
            throw new Error("Options 'rate-limit-global-windowms' and 'rate-limit-global-max' must be provided together.");
        }

        if (args.maximumReorgLimit === 0) {
            throw new Error("Option 'maximum-reorg-limit' cannot be 0.");
        }
    }
}

export class PisaConfigManager extends ConfigManager {
    public static PisaConfigProperties = [
        new ConfigProperty("json-rpc-url", config => config.jsonRpcUrl, {
            description: "Ethereum blockchain rpc url",
            string: true
        }),
        new ConfigProperty("host-name", config => config.hostName, {
            description: "Service host",
            string: true
        }),
        new ConfigProperty("host-port", config => config.hostPort, {
            description: "Service port",
            number: true
        }),
        new ConfigProperty("responder-key", config => config.responderKey, {
            description: "Private key used for responding to disputes",
            string: true
        }),
        new ConfigProperty("receipt-key", config => config.receiptKey, {
            description: "Private key used to sign receipts",
            string: true
        }),
        new ConfigProperty("db-dir", config => config.dbDir, {
            description: "Database directory",
            string: true
        }),
        new ConfigProperty("loglevel", config => config.loglevel, {
            description: "Verbosity of the logs. Accepted values by increasing verbosity: " + Object.values(LogLevel).join(", "),
            string: true
        }),
        new ConfigProperty("maximum-reorg-limit", config => config.maximumReorgLimit, {
            description: "The maximum depth of reorg that the application can handle. Eg. 100. Max is 200.",
            number: true
        }),
        new ConfigProperty("watcher-response-confirmations", config => config.watcherResponseConfirmations, {
            description: "The number of confirmations on an event before the watcher responds.",
            number: true
        }),
        new ConfigProperty("pisa-contract-address", config => config.pisaContractAddress, {
            description: "The on-chain address of the PISA contract.",
            string: true
        }),
        new ConfigProperty("instance-name", config => config.instanceName, {
            description: "A configurable name for this watchtower instance.",
            string: true
        }),

        new ConfigProperty("rate-limit-user-window-ms", config => config.rateLimitUserWindowMs, {
            description: "Size of the per-user rate limit window in milliseconds",
            number: true
        }),
        new ConfigProperty("rate-limit-user-max", config => config.rateLimitUserMax, {
            description: "Maximum number of per-user requests in the time window",
            number: true
        }),
        new ConfigProperty("rate-limit-user-message", config => config.rateLimitUserMessage, {
            description: "Per-user message to emit when limit is reached",
            string: true
        }),
        new ConfigProperty("rate-limit-global-window-ms", config => config.rateLimitGlobalWindowMs, {
            description: "Size of the global rate limit window in milliseconds",
            number: true
        }),
        new ConfigProperty("rate-limit-global-max", config => config.rateLimitGlobalMax, {
            description: "Maximum number of global requests in the time window",
            number: true
        }),
        new ConfigProperty("rate-limit-global-message", config => config.rateLimitGlobalMessage, {
            description: "Global message to emit when limit is reached",
            string: true
        })
    ];

    constructor() {
        super(PisaConfigManager.PisaConfigProperties);
    }
}

export default config as IArgConfig;
