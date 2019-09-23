// Utility functions for ethers.js
import { ethers } from "ethers";
import { ArgumentError } from "../dataEntities";

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
        // for some reason the ts compiler wont accept the proper types here
        // so we have to use 'any' instead of [string[], any[]] for 'prev'
        (prev: any, cur: [string, any]) => {
            prev[0].push(cur[0]);
            prev[1].push(cur[1]);
            return prev;
        },
        [[] as string[], [] as any[]]
    );
}

// TODO:340: documentation
export function encodeTopicsForPisa(topics: (string | null)[]) {
    if (topics.length > 4) throw new ArgumentError(`There can be at most 4 topics. ${topics.length} were given.`)

    const topicsBitmap = [0, 1, 2, 3].map(idx => topics.length > idx && topics[idx] != null);
    const topicsFull = [0, 1, 2, 3].map(idx => topics.length > idx && topics[idx] != null ? topics[idx] : "0x0000000000000000000000000000000000000000000000000000000000000000");
    return ethers.utils.defaultAbiCoder.encode(["bool[4]", "bytes32[4]"], [topicsBitmap, topicsFull]);
}