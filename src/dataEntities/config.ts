const config = require("../../config.json") as IConfig;

export interface IConfig {
    jsonRpcUrl: string;
    host: {
        name: string;
        port: number;
    },
    watcherKey: string;
}

export default config;