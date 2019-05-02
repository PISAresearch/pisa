import config from "../config.json";

interface IRateConfig {
    windowMs: number;
    max: number;
    message?: string;
}

export interface IApiEndpointConfig {
    rateGlobal?: IRateConfig;
    ratePerUser?: IRateConfig;
}

export interface IConfig {
    jsonRpcUrl: string;
    host: {
        name: string;
        port: number;
    },
    responderKey: string;
    apiEndpoint?: IApiEndpointConfig;
}

export default config as IConfig;