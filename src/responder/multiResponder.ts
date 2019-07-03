import { IEthereumResponseData, StartStopService } from "../dataEntities";
import { EthereumResponder } from "./responder";
import { GasQueue, PisaTransactionIdentifier, GasQueueItem, GasQueueItemRequest } from "./gasQueue";
import { GasPriceEstimator } from "./gasPriceEstimator";
import { ethers } from "ethers";
import { BlockProcessor } from "../blockMonitor";
import { BigNumber } from "ethers/utils";
import { inspect } from "util";
import logger from "../logger";
import { QueueConsistencyError, ArgumentError, ApplicationError } from "../dataEntities/errors";
import { Block } from "../dataEntities/block";
import { Component } from "../blockMonitor/component";

enum ResponderState {
    Pending = 1,
    Mined = 2
}
type PendingResponseState = {
    state: ResponderState.Pending;
    queueItem: GasQueueItemRequest;
};
type MinedResponseState = {
    state: ResponderState.Mined;
    identifier: PisaTransactionIdentifier;
    blockMined: number;
    nonce: number | null;
};
type ResponderAppointmentAnchorState = PendingResponseState | MinedResponseState;

export type ResponderAnchorState = Map<string, ResponderAppointmentAnchorState>;

export class MultiResponder extends EthereumResponder implements Component<ResponderAnchorState, Block> {
    public get queue() {
        return this.mQueue;
    }
    private mQueue: GasQueue;
    private chainId: number;
    private address: string;
    // private minedTransactions: WeakMap<Block, GasQueueItem> = new Map();
    private respondedTransactions: Map<string, GasQueueItemRequest> = new Map();

    // every time a new response arrives, I record it
    // then we add it to the anchor state
    // when it's mined we update the anchor state
    // of course, eventually it is removed
    // if a reorg happens the state is reverted

    /**
     * Can handle multiple response for a given signer. This responder requires exclusive
     * use of the signer, as it carefully manages the nonces of the transactions created by
     * the signer. Can handle a concurrent number of responses up to maxQueueDepth
     * @param signer
     *   The signer used to sign transaction created by this responder. This responder
     *   requires exclusive use of this signer.
     * @param gasEstimator
     * @param transactionTracker
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
    constructor(
        signer: ethers.Signer,
        private readonly blockProcessor: BlockProcessor<Block>,
        private readonly gasEstimator: GasPriceEstimator,
        private readonly transactionTracker: TransactionTracker,
        public readonly maxConcurrentResponses: number = 12,
        public readonly replacementRate: number = 13
    ) {
        super(signer);
        if (replacementRate < 0) throw new ArgumentError("Cannot have negative replacement rate.", replacementRate);
        if (maxConcurrentResponses < 1) {
            throw new ArgumentError("Maximum concurrent requests must be greater than 0.", maxConcurrentResponses);
        }
        this.setup = this.setup.bind(this);
        this.txMined = this.txMined.bind(this);
        this.broadcast = this.broadcast.bind(this);
    }

    private blockContainsTransaction(
        block: Block,
        identifier: PisaTransactionIdentifier
    ): { blockNumber: number; nonce: number; from: string } | null {
        for (const tx of block.transactions) {
            // a contract creation - cant be of interest
            if (!tx.to) continue;

            // look for matching transactions
            const txIdentifier = new PisaTransactionIdentifier(tx.chainId, tx.data, tx.to, tx.value, tx.gasLimit);
            if (txIdentifier.equals(identifier)) {
                return {
                    blockNumber: tx.blockNumber!,
                    nonce: tx.nonce,
                    from: tx.from
                };
            }
        }

        return null;
    }

    private getMinedTransaction(identifier: PisaTransactionIdentifier) {
        for (const block of this.blockProcessor.blockCache.ancestry(this.blockProcessor.head.hash)) {
            const txInfo = this.blockContainsTransaction(block, identifier);
            if (txInfo) return txInfo;
        }
        return null;
    }

    private minedByThisResponder(address: string) {
        return address.toLocaleLowerCase() === this.address.toLocaleLowerCase();
    }

    public reduce(prevState: ResponderAnchorState, block: Block): ResponderAnchorState {
        // make sure the anchor state is full

        const result: ResponderAnchorState = new Map();

        // check the block for each of the current pending items
        for (const key of this.respondedTransactions.keys()) {
            // for each item there should be somthing in the responder state
            const queueItemRequest = this.respondedTransactions.get(key)!;
            const val = prevState.get(key);

            if (!val) {
                // has this transaction been mined?
                const minedTx = this.getMinedTransaction(queueItemRequest.identifier);

                if (minedTx === null) {
                    result.set(key, {
                        state: ResponderState.Pending,
                        queueItem: queueItemRequest
                    });
                } else {
                    result.set(key, {
                        state: ResponderState.Mined,
                        blockMined: minedTx.blockNumber,
                        identifier: queueItemRequest.identifier,
                        nonce: this.minedByThisResponder(minedTx.from) ? minedTx.nonce : null
                    });
                }
            } else if (val.state === ResponderState.Pending) {
                const transaction = this.blockContainsTransaction(block, val.queueItem.identifier);
                if (transaction) {
                    result.set(key, {
                        identifier: val.queueItem.identifier,
                        blockMined: block.number,
                        nonce: this.minedByThisResponder(transaction.from) ? transaction.nonce : null,
                        state: ResponderState.Mined
                    });
                } else {
                    result.set(key, {
                        state: ResponderState.Pending,
                        queueItem: val.queueItem
                    });
                }
            }
        }

        // do nothing for mined items

        return result;
    }

    public async handleNewStateEvent(
        prevHead: Block,
        prevState: ResponderAnchorState,
        head: Block,
        state: ResponderAnchorState
    ) {
        // TODO:198: what happens to errors in here? what should we do about them

        // a reorg may have occurred, if this is the case then we need to check whether
        // then some transactions that we had previously considered mined may no longer
        // be. We can find these transactions by comparing the current gas queue to the
        // transactions that we currently observe in pending. Transactions in pending
        // but not in the gas queue need to be added there.

        const missingQueueItems: GasQueueItemRequest[] = [];

        for (const transactionState of state.values()) {
            if (
                transactionState.state === ResponderState.Pending &&
                // TODO:198: add back the contains and difference functions
                this.queue.queueItems.findIndex(i =>
                    i.request.identifier.equals(transactionState.queueItem.identifier)
                ) === -1
            ) {
                missingQueueItems.push(transactionState.queueItem);
            }
        }

        if (missingQueueItems.length !== 0) {
            // TODO:198: remoe this if above - also fill in the unlock of course
            // also, what if this is called before setup - should we setup in here?
            const unlockedQueue = this.queue.unlock(missingQueueItems);
            const replacedTransactions = unlockedQueue.queueItems.filter(tx => !this.mQueue.queueItems.includes(tx));
            this.mQueue = unlockedQueue;
            // broadcast these transactions
            await Promise.all(replacedTransactions.map(this.broadcast));
        }

        // now check to see if any transactions have been mined
        const txMined = (st: ResponderAppointmentAnchorState | undefined): st is MinedResponseState => {
            if (!st) return false;
            return st.state === ResponderState.Mined;
        };

        // TODO:198: sort out the names in the responder - sometimes we refer to the
        // response, sometimes tx, but we key it all by appointment id
        const shouldRemoveTx = (block: Block, st: ResponderAppointmentAnchorState | undefined): boolean => {
            if (!st) return false;
            return (
                st.state === ResponderState.Mined &&
                block.number - st.blockMined > this.blockProcessor.blockCache.maxDepth - 1
            );
        };

        for (const appointmentId of state.keys()) {
            const prevItem = prevState.get(appointmentId);
            const currentItem = state.get(appointmentId);

            if (!txMined(prevItem) && txMined(currentItem)) {
                await this.txMined(currentItem.identifier, currentItem.nonce);
            }

            if (!shouldRemoveTx(prevHead, prevItem) && shouldRemoveTx(head, currentItem)) {
                this.respondedTransactions.delete(appointmentId);
            }
        }
    }

    // we do some async setup
    private async setup() {
        if (!this.mQueue) {
            this.address = await this.signer.getAddress();
            const nonce = await this.provider.getTransactionCount(this.address);
            this.chainId = (await this.provider.getNetwork()).chainId;
            this.mQueue = new GasQueue([], nonce, this.replacementRate, this.maxConcurrentResponses);
        }
    }

    public async startResponse(appointmentId: string, responseData: IEthereumResponseData) {
        try {
            // TODO:198: somewhere we should also check if we actually need to respond to this

            await this.setup();
            if (this.mQueue.depthReached()) {
                throw new QueueConsistencyError(
                    `Cannot add to queue. Max queue depth ${this.mQueue.maxQueueDepth} reached.`
                );
            }

            // form a queue item request
            const abiInterface = new ethers.utils.Interface(responseData.contractAbi);
            const data = abiInterface.functions[responseData.functionName].encode(responseData.functionArgs);
            const txIdentifier = new PisaTransactionIdentifier(
                this.chainId,
                data,
                responseData.contractAddress,
                new BigNumber(0),
                new BigNumber(EthereumResponder.GAS_LIMIT)
            );
            const idealGas = await this.gasEstimator.estimate(responseData);
            const request = new GasQueueItemRequest(txIdentifier, idealGas, responseData);

            // add the queue item to the queue, since the queue is ordered this may mean
            // that we need to replace some transactions on the network. Find those and
            // broadcast them
            const replacedQueue = this.mQueue.add(request);
            const replacedTransactions = replacedQueue.queueItems.filter(tx => !this.mQueue.queueItems.includes(tx));
            this.mQueue = replacedQueue;
            // and update the local list of tx identifiers
            this.respondedTransactions.set(appointmentId, request);

            await Promise.all(replacedTransactions.map(this.broadcast));
        } catch (doh) {
            if (doh instanceof QueueConsistencyError) logger.error(doh.stack!);
            else {
                logger.error(`Unexpected error trying to respond for: ${appointmentId}.`);
                if (doh.stack) logger.error(doh.stack);
                else logger.error(doh);
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
    public async txMined(txIdentifier: PisaTransactionIdentifier, nonce: number | null) {
        try {
            // since we've made this method available publicly we need to ensure that the class has been initialised
            await this.setup();

            if (this.mQueue.queueItems.length === 0) {
                throw new QueueConsistencyError(
                    `Transaction mined for empty queue at nonce ${nonce}. ${inspect(txIdentifier)}`
                );
            }
            if (this.mQueue.queueItems.findIndex(i => i.request.identifier.equals(txIdentifier)) === -1) {
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

            if (!nonce) {
                // TODO:198: nonce can be null if we didnt mine this tx - in this case we
                // dequeue and cancel
                throw new ApplicationError("Not implemented.");
            }

            if (txIdentifier.equals(frontItem.request.identifier)) {
                // the mined transaction was the one at the front of the current queue
                // this is what we hoped for, simply dequeue the transaction
                this.mQueue = this.mQueue.dequeue();
            } else {
                // the mined transaction was not the one at the front of the current queue
                // - it was at the front of a past queue. This means that the transaction
                // at the front of the current queue can no longer be mined as it shares the same
                // nonce. We need to find the transaction in the current queue that corresponds to
                // the mined tx and remove it. In doing so free up a later nonce.
                // and bump up all transactions with a lower nonce so that the tx that is
                // at the front of the current queue - but was not mined - remains there
                const reducedQueue = this.mQueue.consume(txIdentifier);
                const replacedTransactions = reducedQueue.queueItems.filter(tx => !this.mQueue.queueItems.includes(tx));
                this.mQueue = reducedQueue;

                // since we had to bump up some transactions - change their nonces
                // we'll have to issue new transactions to the network
                await Promise.all(replacedTransactions.map(this.broadcast));
            }
        } catch (doh) {
            if (doh instanceof QueueConsistencyError) logger.error(doh.stack!);
            else {
                logger.error(`Unexpected error after mining transaction. ${txIdentifier}.`);
                if (doh.stack) logger.error(doh.stack);
                else logger.error(doh);
            }
        }
    }

    private async broadcast(queueItem: GasQueueItem) {
        try {
            this.transactionTracker.addTx(queueItem.request.identifier, this.txMined);
            await this.signer.sendTransaction(queueItem.toTransactionRequest());
        } catch (doh) {
            // we've failed to broadcast a transaction however this isn't a fatal
            // error. Periodically, we look to see if a transaction has been mined
            // for whatever reason if not then we'll need to re-issue the transaction
            // anyway
            if (doh.stack) logger.error(doh.stack);
            else logger.error(doh);
        }
    }
}

export class TransactionTracker extends StartStopService {
    constructor(private readonly blockProcessor: BlockProcessor<Block>) {
        super("transaction-tracker");
        this.checkTxs = this.checkTxs.bind(this);
    }
    private lastBlockNumber: number;
    private readonly txCallbacks: Map<
        PisaTransactionIdentifier,
        (txIdentifier: PisaTransactionIdentifier, nonce: number) => {}
    > = new Map();

    protected async startInternal() {
        this.lastBlockNumber = this.blockProcessor.head.number;
        this.blockProcessor.on(BlockProcessor.NEW_HEAD_EVENT, this.checkTxs);
    }

    protected async stopInternal() {
        this.blockProcessor.off(BlockProcessor.NEW_HEAD_EVENT, this.checkTxs);
    }

    public addTx(
        identifier: PisaTransactionIdentifier,
        callback: (txIdentifier: PisaTransactionIdentifier, nonce: number) => {}
    ) {
        this.txCallbacks.set(identifier, callback);
    }

    public hasTx(identifier: PisaTransactionIdentifier) {
        return this.txCallbacks.has(identifier);
    }

    private checkTxs(blockNumber: number, blockHash: string) {
        let blockStub = this.blockProcessor.blockCache.getBlockStub(blockHash);

        for (let index = blockNumber; index > this.lastBlockNumber; index--) {
            if (!blockStub) continue;
            // check all the transactions in that block
            const txs = this.blockProcessor.blockCache.getBlockStub(blockStub.hash)!.transactions;
            if (!txs) continue;

            for (const tx of txs) {
                // if the transaction doesn't have a to field populated it is a contract creation tx
                // which means it cant be a transaction to a PISA contract
                if (!tx.to) continue;

                // look for matching transactions
                const txIdentifier = new PisaTransactionIdentifier(tx.chainId, tx.data, tx.to, tx.value, tx.gasLimit);
                for (const callbackKey of this.txCallbacks.keys()) {
                    if (callbackKey.equals(txIdentifier)) {
                        const callback = this.txCallbacks.get(callbackKey);
                        this.txCallbacks.delete(callbackKey);
                        callback!(txIdentifier, tx.nonce);
                    }
                }
            }

            // move on to the next block
            blockStub = this.blockProcessor.blockCache.getBlockStub(blockStub.parentHash);
        }

        this.lastBlockNumber = blockNumber;
    }
}
