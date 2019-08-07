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
import { LevelUp } from "levelup";
import EncodingDown from "encoding-down";
const sub = require("subleveldown");
import { LockManager } from "../utils/lock";

export class ResponderStore extends StartStopService {
    public get transactions(): ReadonlyMap<string, GasQueueItem> {
        return this.mTransactions;
    }

    private readonly mTransactions: Map<string, GasQueueItem> = new Map();
    /**
     * A single global lock on this store to be taken out whenever reading or
     * writing to the store.
     */
    public readonly lock: string;
    private mQueue: GasQueue;
    public get queue() {
        return this.mQueue;
    }

    private readonly subDb: LevelUp<EncodingDown<string, any>>;
    private readonly queueKey: string;
    /**
     * A persistent store for responder data.
     * @param db A backend database for the store
     * @param responderAddress The address of the responder using this store. Responder public keys can only
     * be used by one responder at a time.
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
    constructor(db: LevelUp<EncodingDown<string, any>>, responderAddress: string, seedQueue: GasQueue) {
        super("responder-store");
        this.subDb = sub(db, `responder:${responderAddress}`);
        this.mQueue = seedQueue;
        this.queueKey = `${responderAddress}:queue`;
        this.lock = responderAddress;
    }

    protected async startInternal() {
        // buffer any existing state
        const { queue, respondedTransactions } = await this.getAll();
        if (queue) {
            this.mQueue = new GasQueue(
                queue.queueItems,
                queue.emptyNonce,
                this.mQueue.replacementRate,
                this.mQueue.maxQueueDepth
            );
        }

        for (const [key, value] of respondedTransactions.entries()) {
            this.mTransactions.set(key, value);
        }
    }
    protected async stopInternal() {}

    /**
     * Update the queue. Returns a new transactions that need to be issued as result of the update.
     * @param queue
     */
    public async updateQueue(queue: GasQueue) {
        // const replacedQueue = this.zQueue.add(request);
        const difference = queue.difference(this.mQueue);
        this.mQueue = queue;

        // update these transactions locally and in the db
        const differencyById = new Map<string, GasQueueItem>();
        difference.forEach(d => {
            const id = d.request.appointment.id
            this.mTransactions.set(id, d);
            differencyById.set(id, d);
        });

        let batch = this.subDb.batch().put(this.queueKey, GasQueue.serialise(queue));
        for (const [key, value] of differencyById.entries()) {
            batch = batch.put(key, value);
        }
        await batch.write();

        return difference;
    }

    /**
     * Remove a response keyed by its id
     * @param id
     */
    public async removeResponse(id: string) {
        this.mTransactions.delete(id);
        await this.subDb.del(id);
    }

    /**
     * Get the full contents of the database. One queue, and a map of responded transactions
     */
    private async getAll(): Promise<{
        queue: GasQueue | undefined;
        respondedTransactions: ReadonlyMap<string, GasQueueItem>;
    }> {
        let queue;
        const transactions = new Map();
        for await (const keyValue of this.subDb.createReadStream()) {
            const { key, value } = keyValue as any;
            if (key === this.queueKey) {
                // this is the queue
                queue = GasQueue.deserialise(value);
            } else {
                // this is a transactions
                transactions.set(key, GasQueueItem.deserialise(value));
            }
        }

        return { queue: queue, respondedTransactions: transactions };
    }
}

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
     * The current queue of pending transaction being handled by this responder
     */
    public get queue() {
        return this.zStore.queue;
    }

    /**
     * Can handle multiple response for a given signer. This responder requires exclusive
     * use of the signer, as it carefully manages the nonces of the transactions created by
     * the signer. Can handle a concurrent number of responses up to maxConcurrentResponses
     * @param signer
     *   The signer used to sign transaction created by this responder. This responder
     *   requires exclusive use of this signer.
     * @param gasEstimator
     */
    public constructor(
        public readonly signer: ethers.Signer,
        public readonly gasEstimator: GasPriceEstimator,
        private readonly chainId: number,
        store: ResponderStore,
        public readonly address: string
    ) {
        this.broadcast = this.broadcast.bind(this);
        this.zStore = store;
    }

    /**
     * Issue a transaction to the network, and add a record to the responded transactions list
     */
    public async startResponse(appointment: Appointment) {
        try {
            const replacedTransactions = await this.lockManager.withLock(this.zStore.lock, async () => {
                if (this.zStore.queue.depthReached()) {
                    throw new QueueConsistencyError(
                        `Cannot add to queue. Max queue depth ${this.zStore.queue.maxQueueDepth} reached.`
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
                const replacedQueue = this.zStore.queue.add(request);
                return await this.zStore.updateQueue(replacedQueue);
            });

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
