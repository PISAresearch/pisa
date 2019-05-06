// Utility functions for ethers.js

import ethers from 'ethers';
import { Provider, BaseProvider } from "ethers/providers";
import { CancellablePromise } from '.';

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
 * Throws a `ReorgError` if the corresponding transaction is not found; if `alreadyMined` is `true`, it will assume
 * that the transaction had already been mined at the time of the call
 *
 * This promise is similar in to the `tx.wait` function from ethers.js, but the behavior of ethers.js in case of a re-org
 * is unclear (in particular, what happens if the transaction is mined, but it is kicked out of the blockchain because of
 * a re-org before reaching the required number of confirmations?).
 *
 * @param provider
 * @param txHash
 * @param confirmationsRequired
 * @param alreadyMined If true, it is assumed that the transaction was already mined. Thus, if not found by the provider,
 *                     a `ReorgError` will be thrown immediately. Otherwise, a `ReorgError` will be thrown only if the
 *                     provider finds the transaction when a block is received, but it does not after a subsequent block.
 */
export function waitForConfirmations(provider: Provider, txHash: string, confirmationsRequired: number, alreadyMined: boolean): CancellablePromise<void> {
    let verifyTx: () => Promise<boolean>;

    const cleanup = () => {
        provider.removeListener("block", verifyTx);
    }

    return new CancellablePromise(async (resolve, reject) => {
        verifyTx = async () => {
            const receipt = await provider.getTransactionReceipt(txHash);
            if (receipt === null) {
                if (alreadyMined) {
                    // There was likely a re-org at this provider.
                    cleanup();
                    reject(new ReorgError("There could have been a re-org, the transaction was sent but was later not found."));
                    return true;
                }
            } else {
                if (receipt.blockNumber !== null) {
                    alreadyMined = true;
                }
                if (receipt.confirmations! >= confirmationsRequired) {
                    cleanup();
                    resolve();
                    return true;
                }
            }
            return false;
        };

        // Check immediately, then at every new block
        if (await verifyTx() === false) { // no point in subscribing if already fulfilled
            provider.on("block", verifyTx);
        }
    }, cleanup);
}

/**
 * A simple custom Error class to signal that the speified number of blocks has been mined.
 */
export class BlockThresholdReachedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BlockThresholdReachedError";
    }
}

/**
 * Returns a CancellablePromise that observes the `provider` and rejects as soon as at least `blockCount`
 * new blocks are mined since `sinceBlock`. 
 *
 * @param provider
 * @param sinceBlock
 * @param blockCount
 */
export function rejectAfterBlocks(provider: ethers.providers.Provider, sinceBlock: number, blockCount: number): CancellablePromise<void> {
    let newBlockHandler: (blockNumber: number) => any;

    const cleanup = () => {
        provider.removeListener("block", newBlockHandler);
    }

    return new CancellablePromise((_, reject) => {
        newBlockHandler = (blockNumber: number) => {
            if (blockNumber >= sinceBlock + blockCount) {
                cleanup();
                reject(new BlockThresholdReachedError("Block threshold reached"));
            }
        };

        provider.on("block", newBlockHandler);
    }, cleanup);
}


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
 * Returns a CancellablePromise that observes the `provider` and rejects with `NoNewBlockError` if no new block is received for `timeout`
 * milliseconds starting from `startTime`. The condition is tested every `pollInterval` milliseconds.
 *
 */
export function rejectIfAnyBlockTimesOut(provider: ethers.providers.Provider, startTime: number, timeout: number, pollInterval: number): CancellablePromise<void> {
    let newBlockHandler: (blockNumber: number) => any;
    let timeoutHandler: NodeJS.Timeout;

    let timeLastBlockReceived = startTime;

    const cleanup = () => {
        provider.removeListener("block", newBlockHandler);
        clearTimeout(timeoutHandler);
    }

    return new CancellablePromise((_, reject) => {
        newBlockHandler = () => {
            timeLastBlockReceived = Date.now();
        };

        provider.on("block", newBlockHandler);

        function testCondition() {
            const msSinceLastBlock = Date.now() - timeLastBlockReceived;
            if (msSinceLastBlock > timeout) {
                cleanup();
                reject(new NoNewBlockError(`No new block was received for ${Math.round(msSinceLastBlock/1000)} seconds; provider might be down.`));
            } else {
                timeoutHandler = setTimeout(testCondition, pollInterval);
            }
        }
        testCondition();
    }, cleanup);
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
