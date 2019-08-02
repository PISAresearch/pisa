import config from "../config.json";
import yargs from "yargs";
import { LogLevel } from "../logger";

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
}

class ConfigProperty {
    constructor(
        public readonly commandLineName: string,
        public readonly valueGetter: (config: IArgConfig) => any,
        public readonly yargConfig: any
    ) {}
}

/**
 * Enables parsing and serialising of config objects
 */
export class ConfigManager {
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
            description:
                "Verbosity of the logs. Accepted values by increasing verbosity: " + Object.values(LogLevel).join(", "),
            string: true
        }),
        new ConfigProperty("maximum-reorg-limit", config => config.maximumReorgLimit, {
            description: "The maximum depth of reorg that the application can handle. Eg. 100. Max is 200.",
            number: true
        }),
        new ConfigProperty("watcher-response-confirmations", config => config.watcherResponseConfirmations, {
            description: "The number of confirmations on an event before the watcher responds.",
            number: true
        })
    ];

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
}

export default config as IArgConfig;
