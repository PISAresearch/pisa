// Utility functions for ethers.js

import { Provider, BaseProvider } from "ethers/providers";

/**
 * A simple custom Error class to provide more details in case of a re-org.
 */
export class ReorgError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ReorgError";
    }
}

/**
 * Observes the `provider` for new blocks until the transaction `txHash` has `confirmationsRequired` confirmations.
 * Throws a `ReorgError` if the corresponding transaction is not found; assuming that it was found when this function
 * is called, this is likely caused by a block re-org.
 *
 * @param provider
 * @param txHash 
 * @param confirmationsRequired 
 */
export function waitForConfirmations(provider: Provider, txHash: string, confirmationsRequired: number) : Promise<void> {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            provider.removeListener("block", newBlockHandler);
        }

        const newBlockHandler = async () => {
            const receipt = await provider.getTransactionReceipt(txHash);
            if (receipt == null) {
                // There was likely a re-org at this provider.
                cleanup();
                reject(new ReorgError("There could have been a re-org, the transaction was sent but was later not found."));
            } else if (receipt.confirmations >= confirmationsRequired) {
                cleanup();
                resolve();
            }
        };
        provider.on("block", newBlockHandler);
    });
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
