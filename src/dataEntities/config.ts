const config = require("../../configs.json") as IConfig;

export interface IConfig {
    jsonRpcUrl: string;
    host: {
        name: string;
        port: number;
    },
    watcherKey: string;
}

export default config;