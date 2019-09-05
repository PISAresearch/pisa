import {
    PisaTransactionIdentifier,
    GasQueueItem,
    GasQueueItemRequest,
    GasQueueError,
    GasQueueErrorKind
} from "./gasQueue";
import { GasPriceEstimator } from "./gasPriceEstimator";
import { ethers } from "ethers";
import { BigNumber } from "ethers/utils";
import { inspect } from "util";
import logger from "../logger";
import { QueueConsistencyError, ArgumentError, PublicInspectionError } from "../dataEntities/errors";
import { LockManager } from "../utils/lock";
import { ResponderStore } from "./store";

export class MultiResponder {
    private readonly zStore: ResponderStore;
    private readonly lockManager = new LockManager();
    /**
     * The current queue of pending transaction being handled by this responder
     */
    public get transactions() {
        return this.zStore.transactions;
    }

    /**
     * Can handle multiple response for a given signer. This responder requires exclusive
     * use of the signer, as it carefully manages the nonces of the transactions created by
     * the signer. Can handle a concurrent number of responses up to maxConcurrentResponses
     * @param signer
     *   The signer used to sign transaction created by this responder. This responder
     *   requires exclusive use of this signer.
     * @param gasEstimator
     * @param balanceThreshold
     *   This value respresents the minimum threshold the responder balance (in wei) can reach before a
     *   "low balance warning" will be issued
     * @param chainId The id of the ethereum chain that this responder is using
     * @param balanceThreshold When the balance of the signer gets below this threshold the responder starts issuing warnings
     * @param pisaContractAddress The address of the pisa contract that this responder is using
     */
    public constructor(
        public readonly signer: ethers.Signer,
        public readonly gasEstimator: GasPriceEstimator,
        private readonly chainId: number,
        store: ResponderStore,
        public readonly address: string,
        public readonly balanceThreshold: BigNumber,
        public readonly pisaContractAddress: string
    ) {
        this.broadcast = this.broadcast.bind(this);
        this.zStore = store;
    }

    /**
     * Issues a transaction to the network, and stores it so that it can monitored for confirmations
     * @param to The address the submitted transaction should be addressed to
     * @param responseData The data to be submitted in the transactions
     * @param gasLimit The gas to be supplied with the transaction
     * @param responseId A unique id for this response
     * @param startBlock The responder will not match responses prior to this block
     * @param endBlock The deadline by which this response must be mined
     */
    public async startResponse(
        to: string,
        responseData: string,
        gasLimit: number,
        responseId: string,
        startBlock: number,
        endBlock: number
    ) {
        try {
            // form a queue item request
            const txIdentifier = new PisaTransactionIdentifier(
                this.chainId,
                responseData,
                to,
                new BigNumber(0),
                new BigNumber(gasLimit)
            );

            const replacedTransactions = await this.lockManager.withLock(this.zStore.lock, async () => {
                if (this.zStore.queue.depthReached()) {
                    throw new QueueConsistencyError(
                        `Cannot add to queue. Max queue depth ${this.zStore.queue.maxQueueDepth} reached.`
                    );
                }

                const idealGas = await this.gasEstimator.estimate(endBlock);
                const request = new GasQueueItemRequest(txIdentifier, idealGas, responseId, startBlock);
                logger.info(request, `Enqueueing request for ${responseId}.`);

                // add the queue item to the queue, since the queue is ordered this may mean
                // that we need to replace some transactions on the network. Find those and
                // broadcast them
                const replacedQueue = this.zStore.queue.add(request);
                return await this.zStore.updateQueue(replacedQueue);
            });

            await Promise.all(replacedTransactions.map(b => this.broadcast(b)));
        } catch (doh) {
            logger.error(doh);

            // we rethrow to the public if this item is already enqueued.
            if (doh instanceof GasQueueError && doh.kind === GasQueueErrorKind.AlreadyAdded) {
                throw new PublicInspectionError(`Appointment already being responded to.`);
            }
        }
    }

    /**
     * A newly mined transaction requires updating the local representation of the
     * transaction pool. If a transaction has been mined, but was already replaced
     * then more transactions may need to be re-issued.
     * @param txIdentifier
     * Identifier of the mined transaction
     * @param nonce
     * Nonce of the mined transaction. Should always correspond to the nonce at the
     * front of the current transaction queue. Will throw QueueConsistencyError otherwise.
     * This enforces that this method is called in the same order that transactions are mined
     */
    public async txMined(txIdentifier: PisaTransactionIdentifier, nonce: number) {
        try {
            const replacedTransactions = await this.lockManager.withLock(this.zStore.lock, async () => {
                if (this.zStore.queue.queueItems.length === 0) {
                    throw new QueueConsistencyError(
                        `Transaction mined for empty queue at nonce ${nonce}. ${inspect(txIdentifier)}`
                    );
                }
                if (
                    this.zStore.queue.queueItems.findIndex(item => item.request.identifier.equals(txIdentifier)) === -1
                ) {
                    throw new QueueConsistencyError(
                        `Transaction identifier not found in queue. ${inspect(txIdentifier)}`
                    );
                }
                const frontItem = this.zStore.queue.queueItems[0];
                if (frontItem.nonce !== nonce) {
                    throw new QueueConsistencyError(
                        `Front of queue nonce ${frontItem.nonce} does not correspond to nonce ${nonce}. ${inspect(
                            txIdentifier
                        )}`
                    );
                }

                if (txIdentifier.equals(frontItem.request.identifier)) {
                    // the mined transaction was the one at the front of the current queue
                    // this is what we hoped for, simply dequeue the transaction
                    logger.info(`Transaction is front of queue.`);
                    const dequeuedQueue = this.zStore.queue.dequeue();
                    return await this.zStore.updateQueue(dequeuedQueue);
                } else {
                    // the mined transaction was not the one at the front of the current queue
                    // - it was at the front of a past queue. This means that the transaction
                    // at the front of the current queue can no longer be mined as it shares the same
                    // nonce. We need to find the transaction in the current queue that corresponds to
                    // the mined tx and remove it. In doing so free up a later nonce.
                    // and bump up all transactions with a lower nonce so that the tx that is
                    // at the front of the current queue - but was not mined - remains there
                    logger.info(`Transaction has since been replaced.`);
                    const reducedQueue = this.zStore.queue.consume(txIdentifier);
                    return await this.zStore.updateQueue(reducedQueue);
                }
            });

            // since we had to bump up some transactions - change their nonces
            // we'll have to issue new transactions to the network - we dont need to do this in the lock
            // we can just assume so may fail in a race condition
            if (replacedTransactions) await Promise.all(replacedTransactions.map(b => this.broadcast(b)));
        } catch (doh) {
            logger.error(doh);
        }
    }

    /**
     * Checks to see if all of the current items being tracked by this responder
     * are still in the mempool, or mined. If any are missing new transactions are
     * issued to ensure that all responses are made.
     * @param queueItems
     */
    public async reEnqueueMissingItems(appointmentIdsStillPending: string[]) {
        const replacedTransactions = await this.lockManager.withLock(this.zStore.lock, async () => {
            // a reorg may have occurred, if this is the case then we need to check whether
            // then some transactions that we had previously considered mined may no longer
            // be. We can find these transactions by comparing the current gas queue to the
            // transactions that we currently observe in pending. Transactions in pending
            // but not in the gas queue need to be added there.
            const missingQueueItems = appointmentIdsStillPending
                .map(appId => this.zStore.transactions.get(appId))
                .map(txRecord => {
                    if (!txRecord) throw new ArgumentError("No record of appointment in responder.", txRecord);
                    else return txRecord;
                })
                .filter(item => !this.zStore.queue.contains(item.request.identifier));

            // no need to unlock anything if we dont have any missing items
            if (missingQueueItems.length !== 0) {
                logger.info({ missingItems: missingQueueItems }, `${missingQueueItems.length} items missing from the gas queue. Re-enqueueing.`); //prettier-ignore

                const unlockedQueue = this.zStore.queue.prepend(missingQueueItems);
                return await this.zStore.updateQueue(unlockedQueue);
            }
        });
        if (replacedTransactions) await Promise.all(replacedTransactions.map(b => this.broadcast(b)));
    }

    /**
     * Informs the responder that it can stop tracking a specific appointment
     * @param appointmentId
     */
    public async endResponse(appointmentId: string) {
        await this.lockManager.withLock(this.zStore.lock, async () => {
            await this.zStore.removeResponse(appointmentId);
        });
    }

    private async broadcast(queueItem: GasQueueItem) {
        try {
            const tx = queueItem.toTransactionRequest();
            logger.info({ tx: tx, queueItem: queueItem }, `Broadcasting tx for ${queueItem.request.id}`); // prettier-ignore
            await this.signer.sendTransaction(tx);
        } catch (doh) {
            // we've failed to broadcast a transaction however this isn't a fatal
            // error. Periodically, we look to see if a transaction has been mined
            // for whatever reason if not then we'll need to re-issue the transaction
            // anyway
            logger.error(doh);
        }
    }

    /**
     * Checks to see if the responder balance is lower than the threshold set in the constructor.
     * If the balance is lower, a warning will be outputted by the logger
     */
    public async checkBalance() {
        const currentBalance = await this.signer.provider!.getBalance(this.address);
        if (currentBalance.lt(this.balanceThreshold)) {
            logger.error("Responder balance is becoming low. Current balance: " + currentBalance);
        }
    }
}
