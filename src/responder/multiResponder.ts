import { Appointment, StartStopService } from "../dataEntities";
import {
    GasQueue,
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

export class MultiResponder extends StartStopService {
    private readonly provider: ethers.providers.Provider;
    /**
     * The current queue of pending transaction being handled by this responder
     */
    public get queue() {
        return this.mQueue;
    }
    private mQueue: GasQueue;
    public readonly respondedTransactions: Map<string, GasQueueItem> = new Map();
    private chainId: number;
    /**
     * The address of the private signing key being used to create responses
     *
     */
    public get address() {
        return this.mAddress;
    }
    private mAddress: string;

    /**
     * Can handle multiple response for a given signer. This responder requires exclusive
     * use of the signer, as it carefully manages the nonces of the transactions created by
     * the signer. Can handle a concurrent number of responses up to maxConcurrentResponses
     * @param signer
     *   The signer used to sign transaction created by this responder. This responder
     *   requires exclusive use of this signer.
     * @param gasEstimator
     * @param maxConcurrentResponses
     *   Parity and Geth set maximums on the number of pending transactions in the
     *   pool that can emanate from a single account. Current defaults:
     *   Parity: max(16, 1% of the pool): https://wiki.parity.io/Configuring-Parity-Ethereum --tx-queue-per-sender
     *   Geth: 64: https://github.com/ethereum/go-ethereum/wiki/Command-Line-Options --txpool.accountqueue
     * @param replacementRate
     *   This responder replaces existing transactions on the network.
     *   This replacement rate is set by the nodes. The value should be the percentage increase
     *   eg. 13. Must be positive.
     *   Parity: 12.5%: https://github.com/paritytech/parity-ethereum/blob/master/miner/src/pool/scoring.rs#L38
     *   Geth: 10% default : https://github.com/ethereum/go-ethereum/wiki/Command-Line-Options --txpool.pricebump
     */
    public constructor(
        public readonly signer: ethers.Signer,
        public readonly gasEstimator: GasPriceEstimator,
        public readonly maxConcurrentResponses: number = 12,
        public readonly replacementRate: number = 13
    ) {
        super("multi-responder");
        this.provider = signer.provider!;
        if (replacementRate < 0) throw new ArgumentError("Cannot have negative replacement rate.", replacementRate);
        if (maxConcurrentResponses < 1) {
            throw new ArgumentError("Maximum concurrent requests must be greater than 0.", maxConcurrentResponses);
        }
        this.broadcast = this.broadcast.bind(this);
    }

    protected async startInternal() {
        this.mAddress = await this.signer.getAddress();
        const nonce = await this.provider.getTransactionCount(this.mAddress, "pending");
        this.chainId = (await this.provider.getNetwork()).chainId;
        this.mQueue = new GasQueue([], nonce, this.replacementRate, this.maxConcurrentResponses);
    }

    protected async stopInternal() {
        // do nothing
    }

    /**
     * Issue a transaction to the network, and add a record to the responded transactions list
     */
    public async startResponse(appointment: Appointment) {
        try {
            if (this.mQueue.depthReached()) {
                throw new QueueConsistencyError(
                    `Cannot add to queue. Max queue depth ${this.mQueue.maxQueueDepth} reached.`
                );
            }

            // form a queue item request
            const txIdentifier = new PisaTransactionIdentifier(
                this.chainId,
                appointment.data,
                appointment.contractAddress,
                new BigNumber(0),
                appointment.gasLimit
            );

            const idealGas = await this.gasEstimator.estimate(appointment);
            const request = new GasQueueItemRequest(txIdentifier, idealGas, appointment);
            logger.info(request, `Enqueueing request for ${appointment.id}.`);

            // add the queue item to the queue, since the queue is ordered this may mean
            // that we need to replace some transactions on the network. Find those and
            // broadcast them
            //PROBLEM HERE
            const replacedQueue = this.mQueue.add(request);
            const replacedTransactions = replacedQueue.difference(this.mQueue);
            this.mQueue = replacedQueue;

            // and update the local list of tx identifiers for the latest data, then broadcast
            replacedTransactions.forEach(q => this.respondedTransactions.set(q.request.appointment.id, q));
            await Promise.all(replacedTransactions.map(b => this.broadcast(b)));
        } catch (doh) {
            logger.error(doh);

            // we rethrow to the public if this item is already enqueued.
            if (doh instanceof GasQueueError && doh.kind === GasQueueErrorKind.AlreadyAdded) {
                throw new PublicInspectionError(`Appointment already in queue. ${inspect(appointment)}`);
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
            if (this.mQueue.queueItems.length === 0) {
                throw new QueueConsistencyError(
                    `Transaction mined for empty queue at nonce ${nonce}. ${inspect(txIdentifier)}`
                );
            }
            if (this.mQueue.queueItems.findIndex(item => item.request.identifier.equals(txIdentifier)) === -1) {
                throw new QueueConsistencyError(`Transaction identifier not found in queue. ${inspect(txIdentifier)}`);
            }
            const frontItem = this.mQueue.queueItems[0];
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
                this.mQueue = this.mQueue.dequeue();
            } else {
                // the mined transaction was not the one at the front of the current queue
                // - it was at the front of a past queue. This means that the transaction
                // at the front of the current queue can no longer be mined as it shares the same
                // nonce. We need to find the transaction in the current queue that corresponds to
                // the mined tx and remove it. In doing so free up a later nonce.
                // and bump up all transactions with a lower nonce so that the tx that is
                // at the front of the current queue - but was not mined - remains there
                logger.info(`Transaction has since been replaced.`);
                const reducedQueue = this.mQueue.consume(txIdentifier);
                const replacedTransactions = reducedQueue.difference(this.mQueue);
                this.mQueue = reducedQueue;
                replacedTransactions.forEach(q => this.respondedTransactions.set(q.request.appointment.id, q));

                // since we had to bump up some transactions - change their nonces
                // we'll have to issue new transactions to the network
                await Promise.all(replacedTransactions.map(b => this.broadcast(b)));
            }
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
        // a reorg may have occurred, if this is the case then we need to check whether
        // then some transactions that we had previously considered mined may no longer
        // be. We can find these transactions by comparing the current gas queue to the
        // transactions that we currently observe in pending. Transactions in pending
        // but not in the gas queue need to be added there.
        const missingQueueItems = appointmentIdsStillPending
            .map(appId => this.respondedTransactions.get(appId))
            .map(txRecord => {
                if (!txRecord) throw new ArgumentError("No record of appointment in responder.", txRecord);
                else return txRecord;
            })
            .filter(item => !this.mQueue.contains(item.request.identifier));

        // no need to unlock anything if we dont have any missing items
        if (missingQueueItems.length !== 0) {
            logger.info({ missingItems: missingQueueItems }, `${missingQueueItems.length} items missing from the gas queue. Re-enqueueing.`); //prettier-ignore
            const unlockedQueue = this.mQueue.prepend(missingQueueItems);
            const replacedTransactions = unlockedQueue.difference(this.mQueue);
            this.mQueue = unlockedQueue;
            replacedTransactions.forEach(q => this.respondedTransactions.set(q.request.appointment.id, q));
            await Promise.all(replacedTransactions.map(b => this.broadcast(b)));
        }
    }

    /**
     * Informs the responder that it can stop tracking a specific appointment
     * @param appointmentId
     */
    public endResponse(appointmentId: string) {
        this.respondedTransactions.delete(appointmentId);
    }

    private async broadcast(queueItem: GasQueueItem) {
        try {
            const tx = queueItem.toTransactionRequest();
            logger.info({ tx: tx, queueItem: queueItem }, `Broadcasting tx for ${queueItem.request.appointment.id}`); // prettier-ignore
            await this.signer.sendTransaction(tx);
        } catch (doh) {
            // we've failed to broadcast a transaction however this isn't a fatal
            // error. Periodically, we look to see if a transaction has been mined
            // for whatever reason if not then we'll need to re-issue the transaction
            // anyway
            logger.error(doh);
        }
    }
}
