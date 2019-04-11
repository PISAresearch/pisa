// Utility functions for ethers.js

import { Provider, TransactionResponse } from "ethers/providers";

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
