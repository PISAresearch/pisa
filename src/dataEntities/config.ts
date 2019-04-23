import config from "../config.json";

export interface IConfig {
    jsonRpcUrl: string;
    host: {
        name: string;
        port: number;
    },
    responderKey: string;
}

export default config as IConfig;