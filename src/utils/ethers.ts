// Utility functions for ethers.js
import { ethers } from "ethers";

/**
 *
 * @param url Get a json rpc provider
 * @param pollingInterval
 */
export const getJsonRPCProvider = (url: string, pollingInterval: number = 100) => {
    const provider = new ethers.providers.JsonRpcProvider(url);
    provider.pollingInterval = pollingInterval;
    return provider;
};

/**
 * Check that the provider has a good connection
 * @param provider
 */
export async function validateProvider(provider: ethers.providers.Provider) {
    try {
        /* if the provider is working then a valid response of a number will be returned
            otherwise, an error will be thrown such as invalid JSON response "" which indicates 
            the connection failed, the error will be caught here and a separate error will be thrown.
            The address is a random valid address taken from ethersjs documentation
        */
        await provider.getTransactionCount("0xD115BFFAbbdd893A6f7ceA402e7338643Ced44a6");
    } catch (err) {
        if ((provider as any).connection && (provider as any).connection.url) {
            throw new Error(`Provider failed to connect to ${(provider as any).connection.url}.\n ${err}`);
        } else throw new Error(`Provider ${JSON.stringify(provider)} failed to connect.\n ${err}`);
    }
}

/**
 * Groupts an array of key value tuples into two arrays, one of keys
 * one of values
 * @param tupleArray
 */
export function groupTuples(tupleArray: [string, any][]): [string[], any[]] {
    return tupleArray.reduce(
        (prev, cur) => {
            prev[0].push(cur[0]);
            prev[1].push(cur[1]);
            return prev;
        },
        [[] as string[], [] as any[]]
    );
}
