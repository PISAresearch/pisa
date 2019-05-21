// Utility functions for ethers.js
import { Provider, BaseProvider } from "ethers/providers";
import { CancellablePromise } from ".";
import { ethers } from "ethers";

/**
 * A simple custom Error class to signal that no new block was received while we
 * were waiting for a transaction to be mined. This might likely signal a failure of
 * the provider.
 */
export class NoNewBlockError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "NoNewBlockError";
    }
}

/**
 * Adds a delay to the provider. When polling, or getting block number, or waiting for confirmations,
 * the provider will behave as if the head is delay blocks deep. Use this function with caution,
 * it depends on the internal behaviour of ethersjs to function correctly, and as such is very
 * brittle. A better long term solution would be persist events observed via ethers js, and act
 * upon them later.
 * @param provider
 * @param delay
 */
export const withDelay = (provider: BaseProvider, delay: number): void => {
    const perform = provider.perform.bind(provider);
    provider.perform = async (method: any, params: any) => {
        let performResult = await perform(method, params);
        if (method === "getBlockNumber") {
            var value = parseInt(performResult);
            if (value != performResult) {
                throw new Error("invalid response - getBlockNumber");
            }
            if (value < delay) {
                throw new Error(`invalid delay - cannot delay: ${delay} more than block height: ${value}`);
            }
            performResult = value - delay;
        }
        return performResult;
    };
};

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
