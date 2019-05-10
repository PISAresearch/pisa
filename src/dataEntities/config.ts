import config from "../config.json";

interface IRateConfig {
    windowMs: number; // size of the rate limit window in milliseconds
    max: number; // maximum number of requests in the time window
    message?: string; // if given, overrides the default message returned in case a user is affected by the rate limit
}

export interface IApiEndpointConfig {
    rateGlobal?: IRateConfig; // global rate limit
    ratePerUser?: IRateConfig; // per-user rate limit
}

export interface IConfig {
    jsonRpcUrl: string;
    host: { // hostname and port for Pisa's API endpoint
        name: string;
        port: number;
    },
    responderKey: string; // private key used for responding to disputes
    receiptKey: string; // private key used to sign receipts
    apiEndpoint?: IApiEndpointConfig; // configuration of the API endpoint
    dbDir: string;
}

export default config as IConfig;