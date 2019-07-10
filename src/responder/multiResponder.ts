import { IEthereumResponseData, StartStopService, IEthereumAppointment } from "../dataEntities";
import { EthereumResponder } from "./responder";
import { GasQueue, PisaTransactionIdentifier, GasQueueItem, GasQueueItemRequest } from "./gasQueue";
import { GasPriceEstimator } from "./gasPriceEstimator";
import { ethers } from "ethers";
import { ReadOnlyBlockCache } from "../blockMonitor";
import { BigNumber } from "ethers/utils";
import { inspect } from "util";
import logger from "../logger";
import { QueueConsistencyError, ArgumentError, ApplicationError } from "../dataEntities/errors";
import { Block } from "../dataEntities/block";
import { Component, StateReducer, MappedStateReducer, MappedState } from "../blockMonitor/component";

enum ResponderStateKind {
    Pending = 1,
    Mined = 2
}
type PendingResponseState = {
    appointmentId: string;
    kind: ResponderStateKind.Pending;
    queueItem: GasQueueItemRequest;
};
type MinedResponseState = {
    appointmentId: string;
    kind: ResponderStateKind.Mined;
    identifier: PisaTransactionIdentifier;
    blockMined: number;
    nonce: number;
    from: string;
};
type ResponderAppointmentAnchorState = PendingResponseState | MinedResponseState;

export interface ResponderAnchorState extends MappedState<ResponderAppointmentAnchorState> {
    blockNumber: number;
}

class ResponderAppointmentReducer implements StateReducer<ResponderAppointmentAnchorState, Block> {
    public constructor(
        private readonly blockCache: ReadOnlyBlockCache<Block>,
        private readonly queueItemRequest: GasQueueItemRequest,
        private readonly appointmentId: string
    ) {}

    private txIdentifierInBlock(
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

    private getMinedTransaction(headHash: string, identifier: PisaTransactionIdentifier) {
        for (const block of this.blockCache.ancestry(headHash)) {
            const txInfo = this.txIdentifierInBlock(block, identifier);
            if (txInfo) return txInfo;
        }
        return null;
    }

    public getInitialState(block: Block): ResponderAppointmentAnchorState {
        // find out the current state of a queue item by looking through all
        // the blocks in the block cache
        const minedTx = this.getMinedTransaction(block.hash, this.queueItemRequest.identifier);

        return minedTx
            ? {
                  appointmentId: this.appointmentId,
                  kind: ResponderStateKind.Mined,
                  blockMined: minedTx.blockNumber,
                  identifier: this.queueItemRequest.identifier,
                  nonce: minedTx.nonce,
                  from: minedTx.from
              }
            : {
                  appointmentId: this.appointmentId,
                  kind: ResponderStateKind.Pending,
                  queueItem: this.queueItemRequest
              };
    }

    public reduce(prevState: ResponderAppointmentAnchorState, block: Block): ResponderAppointmentAnchorState {
        if (prevState.kind === ResponderStateKind.Pending) {
            const transaction = this.txIdentifierInBlock(block, prevState.queueItem.identifier);
            return transaction
                ? {
                      appointmentId: prevState.appointmentId,
                      identifier: prevState.queueItem.identifier,
                      blockMined: block.number,
                      nonce: transaction.nonce,
                      kind: ResponderStateKind.Mined,
                      from: transaction.from
                  }
                : {
                      appointmentId: prevState.appointmentId,
                      kind: ResponderStateKind.Pending,
                      queueItem: prevState.queueItem
                  };
        } else {
            return prevState;
        }
    }
}

class ResponderReducer
    extends MappedStateReducer<ResponderAppointmentAnchorState, Block, { id: string; queueItem: GasQueueItemRequest }>
    implements StateReducer<ResponderAnchorState, Block> {
    constructor(responder: MultiResponder, blockCache: ReadOnlyBlockCache<Block>) {
        super(
            () => [...responder.respondedTransactions.values()],
            item => new ResponderAppointmentReducer(blockCache, item.queueItem, item.id)
        );
    }

    public getInitialState(block: Block) {
        return {
            ...super.getInitialState(block),
            blockNumber: block.number
        };
    }

    public reduce(prevState: ResponderAnchorState, block: Block) {
        return {
            ...super.reduce(prevState, block),
            blockNumber: block.number
        };
    }
}

export class MultiResponderComponent extends Component<ResponderAnchorState, Block> {
    public constructor(
        private readonly responder: MultiResponder,
        blockCache: ReadOnlyBlockCache<Block>,
        private readonly confirmationsRequired: number
    ) {
        // the responder tracks a list of items that it's currently responding
        // to in the respondedTransactions map. We need to examine each of these.
        super(new ResponderReducer(responder, blockCache));
    }

    public isAppointmentPending = (
        appointmentState: ResponderAppointmentAnchorState
    ): appointmentState is PendingResponseState => {
        return appointmentState.kind === ResponderStateKind.Pending;
    };

    public hasResponseBeenMined = (
        appointmentState: ResponderAppointmentAnchorState | undefined
    ): appointmentState is MinedResponseState => {
        if (!appointmentState) return false;
        return appointmentState.kind === ResponderStateKind.Mined;
    };

    public shouldAppointmentBeRemoved = (
        state: ResponderAnchorState,
        appointmentState: ResponderAppointmentAnchorState | undefined
    ): appointmentState is MinedResponseState => {
        if (!appointmentState) return false;
        return (
            appointmentState.kind === ResponderStateKind.Mined &&
            state.blockNumber - appointmentState.blockMined > this.confirmationsRequired
        );
    };

    public async handleNewStateEvent(prevState: ResponderAnchorState, state: ResponderAnchorState) {
        // TODO:198: what happens to errors in here? what should we do about them

        // every time the we handle a new head event there could potentially have been
        // a reorg, which in turn may have caused some items to be lost from the pending pool.
        // Therefor we check all of the missing items and re-enqueue them if necessary
        this.responder.reEnqueueMissingItems(
            [...state.items.values()].filter(this.isAppointmentPending).map(q => q.appointmentId)
        );

        for (const appointmentId of state.items.keys()) {
            const prevItem = prevState.items.get(appointmentId);
            const currentItem = state.items.get(appointmentId);

            // if a transaction has been mined we need to inform the responder
            if (!this.hasResponseBeenMined(prevItem) && this.hasResponseBeenMined(currentItem)) {
                await this.responder.txMined(currentItem.identifier, currentItem.nonce, currentItem.from);
            }

            // after a certain number of confirmations we can stop tracking a transaction
            if (
                !this.shouldAppointmentBeRemoved(state, prevItem) &&
                this.shouldAppointmentBeRemoved(state, currentItem)
            ) {
                await this.responder.endResponse(currentItem.appointmentId);
            }
        }
    }
}

export class MultiResponder extends StartStopService {
    private readonly provider: ethers.providers.Provider;
    public get queue() {
        return this.mQueue;
    }
    private mQueue: GasQueue;
    public readonly respondedTransactions: Map<string, { id: string; queueItem: GasQueueItemRequest }> = new Map();
    private chainId: number;
    private address: string;

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
    //TODO:198: documentation out of date - check everywhere in this file
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
        this.address = await this.signer.getAddress();
        const nonce = await this.provider.getTransactionCount(this.address);
        this.chainId = (await this.provider.getNetwork()).chainId;
        this.mQueue = new GasQueue([], nonce, this.replacementRate, this.maxConcurrentResponses);
    }

    protected async stopInternal() {
        // do nothing
    }

    /**
     * Issue a transaction to the network, and add a record to the responded transactions list
     */
    public async startResponse(appointmentId: string, responseData: IEthereumResponseData) {
        try {
            // TODO:198: somewhere we should also check if we actually need to respond to this
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
            this.respondedTransactions.set(appointmentId, { id: appointmentId, queueItem: request });

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
    public async txMined(txIdentifier: PisaTransactionIdentifier, nonce: number, from: string) {
        try {
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

            if (from.toLocaleLowerCase() !== this.address.toLocaleLowerCase()) {
                // TODO:198: nonce can be null if we didnt mine this tx - in this case we
                // dequeue and cancel the relevant transactions
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

    /**
     * Checks to see if all of the current items being tracked by this responder
     * are still in the mempool, or mined. If any are missing new transactions are
     * issued to ensure that all responses are made.
     * @param queueItems
     */
    public async reEnqueueMissingItems(appointmentIds: string[]) {
        // a reorg may have occurred, if this is the case then we need to check whether
        // then some transactions that we had previously considered mined may no longer
        // be. We can find these transactions by comparing the current gas queue to the
        // transactions that we currently observe in pending. Transactions in pending
        // but not in the gas queue need to be added there.

        const missingQueueItems: GasQueueItemRequest[] = [];
        const queueItems: GasQueueItemRequest[] = [];
        appointmentIds.forEach(a => {
            const record = this.respondedTransactions.get(a);
            if (record) queueItems.push(record.queueItem);
            else throw new ArgumentError("No record of transaction in responder.", a);
        });

        for (const item of queueItems) {
            // TODO:198: add back the contains and difference functions
            if (this.mQueue.queueItems.findIndex(i => i.request.identifier.equals(item.identifier)) === -1) {
                missingQueueItems.push(item);
            }
        }

        if (missingQueueItems.length !== 0) {
            // TODO:198: remoe this if above - also fill in the unlock of course
            // also, what if this is called before setup - should we setup in here?
            const unlockedQueue = this.mQueue.unlock(missingQueueItems);
            const replacedTransactions = unlockedQueue.queueItems.filter(tx => !this.mQueue.queueItems.includes(tx));
            this.mQueue = unlockedQueue;
            // broadcast these transactions
            await Promise.all(replacedTransactions.map(this.broadcast));
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
