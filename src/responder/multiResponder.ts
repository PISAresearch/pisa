import { IEthereumResponseData, StartStopService } from "../dataEntities";
import { EthereumResponder } from "./responder";
import {
    GasQueue,
    PisaTransactionIdentifier,
    GasQueueItem,
    GasQueueItemRequest
} from "./pendingQueue";
import { GasPriceEstimator } from "./gasPriceEstimator";
import { ethers } from "ethers";
import { BlockProcessor } from "../blockMonitor";
import { BigNumber } from "ethers/utils";
import { inspect } from "util";
import logger from "../logger";
import { QueueConsistencyError } from "../dataEntities/errors";

export class MultiResponder extends EthereumResponder {
    private queue: GasQueue;
    private chainId: number;

    /**
     * Can handle multiple response for a given signer. This responder requires exclusive
     * use of the signer, as it carefully manages the nonces of the transactions created by
     * the signer. Can handle a concurrent number of responses up to maxQueueDepth
     * @param signer
     *   The signer used to sign transaction created by this responder. This responder
     *   requires exlusive use of this signer.
     * @param gasEstimator
     * @param transactionTracker
     * @param maxConcurrentResponses
     *   Parity and Geth set maximums on the number of pending transactions in the
     *   pool that can eminate from a single accouunt. Current defaults:
     *   Parity: max(16, 1% of the pool): https://wiki.parity.io/Configuring-Parity-Ethereum --tx-queue-per-sender
     *   Geth: 64: https://github.com/ethereum/go-ethereum/wiki/Command-Line-Options --txpool.accountqueue
     * @param replacementRate
     *   This responder replaces existing transactions on the network.
     *   This replacement rate is set by the nodes.
     *   Parity: 12.5%: https://github.com/paritytech/parity-ethereum/blob/master/miner/src/pool/scoring.rs#L38
     *   Geth: 10% default : https://github.com/ethereum/go-ethereum/wiki/Command-Line-Options --txpool.pricebump
     */
    constructor(
        signer: ethers.Signer,
        private readonly gasEstimator: GasPriceEstimator,
        private readonly transactionTracker: TransactionTracker,
        public readonly maxConcurrentResponses: number = 12,
        public readonly replacementRate: number = 1.13
    ) {
        super(signer);
        this.txMined = this.txMined.bind(this);
        this.broadcast = this.broadcast.bind(this);
    }

    // we do some async setup
    private async setup() {
        if (!this.queue) {
            const address = await this.signer.getAddress();
            const nonce = await this.provider.getTransactionCount(address);
            this.queue = new GasQueue([], nonce, this.replacementRate, this.maxConcurrentResponses);
            this.chainId = (await this.provider.getNetwork()).chainId;
        }
    }

    public async startResponse(appointmentId: string, responseData: IEthereumResponseData) {
        await this.setup();
        if (this.queue.depthReached()) {
            throw new Error(`Cannot add to queue. Max queue depth ${this.queue.maxQueueDepth} reached.`);
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
        const replacedQueue = this.queue.add(request);
        const replacedTransactions = replacedQueue.difference(this.queue);
        this.queue = replacedQueue;
        
        await Promise.all(replacedTransactions.map(this.broadcast));
    }

    /**
     * A newly mined transaction requires updating the local representation of the
     * transaction pool. If a transaction has been mined, but was already replaced
     * then more transactions may need to be re-issued.
     * @param txIdenfifier
     * Identifier of the mined transaction
     * @param nonce
     * Nonce of the mined transaction. Should always correspond to the nonce at the
     * front of the current transaction queue. Will throw ArgumentException otherwise.
     * This enforces that this method is called in the same order that transactions are mined
     */
    public async txMined(txIdenfifier: PisaTransactionIdentifier, nonce: number) {
        try {
            // since we've made this method available publicly we need to ensure that the class has been initialised
            await this.setup();

            if (this.queue.queueItems.length === 0) {
                throw new QueueConsistencyError(
                    `Transaction mined for empty queue at nonce ${nonce}. ${inspect(txIdenfifier)}`
                );
            }
            if (!this.queue.contains(txIdenfifier)) {
                throw new QueueConsistencyError(`Transaction identifier not found in queue. ${inspect(txIdenfifier)}`);
            }
            const frontItem = this.queue.queueItems[0];
            if (frontItem.nonce !== nonce) {
                throw new QueueConsistencyError(
                    `Front of queue nonce ${frontItem.nonce} does not correspond to nonce ${nonce}. ${inspect(
                        txIdenfifier
                    )}`
                );
            }

            if (txIdenfifier.equals(frontItem.request.identifier)) {
                // the mined transaction was the one at the front of the current queue
                // this is what we hoped for, simply dequeue the transaction
                this.queue = this.queue.dequeue();
            } else {
                // the mined transaction was not the one at the front of the current queue
                // - it was at the front of a past queue. This means that the transaction
                // at the front of the current queue can no longer be mined as it shares the same
                // nonce. We need to find the transaction in the current queue that corresponds to
                // the mined tx and remove it. In doing so free up a later nonce.
                // and bump up all transactions with a lower nonce so that the tx that is
                // at the front of the current queue - but was not mined - remains there
                const reducedQueue = this.queue.consume(txIdenfifier);
                const replacedTransactions = reducedQueue.difference(this.queue);
                this.queue = reducedQueue;

                // since we had to bump up some transactions - change their nonces
                // we'll have to issue new transactions to the network
                await Promise.all(replacedTransactions.map(this.broadcast));
            }
        } catch (doh) {
            if (doh instanceof QueueConsistencyError) logger.error(doh.stack!);
            else {
                logger.error(`Unexpected error trying to mine transaction. ${txIdenfifier}.`);
                if (doh.stack) logger.error(doh.stack);
            }
        }
    }

    private async broadcast(queueItem: GasQueueItem) {
        // TODO:174: - any errors?
        // 1. could be nonce too low -what if we do? that means this nonce got mined in the mean time!!! is this possible? yes, always!, so we need to try this operation again with a higher nonce
        // 2. could get not get mined after we added its

        this.transactionTracker.addTx(queueItem.request.identifier, this.txMined);
        await this.signer.sendTransaction(queueItem.toTransactionRequest());
    }
}

export class TransactionTracker extends StartStopService {
    constructor(private readonly blockProcessor: BlockProcessor) {
        super("transaction-tracker");
        this.checkTxs = this.checkTxs.bind(this);
    }
    private lastBlockNumber: number;
    private readonly txCallbacks: Map<
        PisaTransactionIdentifier,
        (txIdenfifier: PisaTransactionIdentifier, nonce: number) => {}
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
        callback: (txIdenfifier: PisaTransactionIdentifier, nonce: number) => {}
    ) {
        this.txCallbacks.set(identifier, callback);
    }

    public hasTx(identifier: PisaTransactionIdentifier) {
        return this.txCallbacks.has(identifier);
    }

    public checkTxs(blockNumber: number, blockHash: string) {
        let blockStub = this.blockProcessor.blockCache.getBlockStub(blockHash);

        for (let index = blockNumber; index > this.lastBlockNumber; index--) {
            // TODO: 174: these conditions should be impossible! so throw error?
            if (!blockStub) continue;
            // check all the transactions in that block
            const txs = this.blockProcessor.blockCache.getTransactions(blockStub.hash);
            if (!txs) continue;

            for (const tx of txs) {
                // if the transaction doesn't have a to field populated it is a contract creation tx
                // which means it cant be a transaction to a PISA contract
                if (!tx.to) continue;

                // look for matching transactions
                const txIdenfifier = new PisaTransactionIdentifier(tx.chainId, tx.data, tx.to, tx.value, tx.gasLimit);

                //TODO: 174: fix this heavy double loop
                for (const callbackKey of this.txCallbacks.keys()) {
                    if (callbackKey.equals(txIdenfifier)) {
                        const callback = this.txCallbacks.get(callbackKey);
                        this.txCallbacks.delete(callbackKey);
                        callback!(txIdenfifier, tx.nonce);
                    }
                }
            }

            // move on to the next block
            blockStub = this.blockProcessor.blockCache.getBlockStub(blockStub.parentHash);
        }

        this.lastBlockNumber = blockNumber;
    }
}

// // TODO:174: does this belong here?
// TODO:174: write up on the existing ticket for this
// public transactionExists(data: IEthereumResponseData): string {
//     throw new Error("not implemented ex")

//     // check the current block chain and pending pool to see if this event
//     // already has a transaction registered for it

//     // if on the blockchain any tx that satisifes will do
//      a) from this node? we should have a record of it in auxiliary state - given that we never revert aux state, and that we always record a tx before broadcast
//      b) from another node? defo possible, if we also submit a tx then we waste money

//     // if in the pending pool check that the gas of that tx is >= ideal gas
//      a) from us? we should have a record, we dont revert the pending queue even if we do a reorg? - but dont we need to ensure that all of those transactions are there? -no, that is ensured already
//      b) from someone else? - at the moment we'll just potentially issue a doube transaction

//     // if true add the tx to the list of observable transactions
// }
