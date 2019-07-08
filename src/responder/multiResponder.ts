import { IEthereumResponseData, IEthereumAppointment } from "../dataEntities";
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
import { Component, StateReducer, MappedStateReducer } from "../blockMonitor/component";

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

export type ResponderAnchorState = Map<string, ResponderAppointmentAnchorState>;

class ResponderReducer implements StateReducer<ResponderAppointmentAnchorState, Block> {
    public constructor(
        private readonly blockProcessor: BlockProcessor<Block>,
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
        for (const block of this.blockProcessor.blockCache.ancestry(headHash)) {
            const txInfo = this.txIdentifierInBlock(block, identifier);
            if (txInfo) return txInfo;
        }
        return null;
    }

    // TODO:198: check this, as it wasn't in the original implementation from Chris
    public getInitialState(block: Block): ResponderAppointmentAnchorState {
        // has this transaction been mined?
        const minedTx = this.getMinedTransaction(block.hash, this.queueItemRequest.identifier);

        if (minedTx === null) {
            return {
                appointmentId: this.appointmentId,
                kind: ResponderStateKind.Pending,
                queueItem: this.queueItemRequest
            };
        } else {
            return {
                appointmentId: this.appointmentId,
                kind: ResponderStateKind.Mined,
                blockMined: minedTx.blockNumber,
                identifier: this.queueItemRequest.identifier,
                nonce: minedTx.nonce,
                from: minedTx.from
            };
        }
    }

    public reduce(prevState: ResponderAppointmentAnchorState, block: Block): ResponderAppointmentAnchorState {
        if (prevState.kind === ResponderStateKind.Pending) {
            const transaction = this.txIdentifierInBlock(block, prevState.queueItem.identifier);
            if (transaction) {
                return {
                    appointmentId: prevState.appointmentId,
                    identifier: prevState.queueItem.identifier,
                    blockMined: block.number,
                    nonce: transaction.nonce,
                    kind: ResponderStateKind.Mined,
                    from: transaction.from
                };
            } else {
                return {
                    appointmentId: prevState.appointmentId,
                    kind: ResponderStateKind.Pending,
                    queueItem: prevState.queueItem
                };
            }
        } else {
            return prevState;
        }
    }
}

export class MultiResponderComponent extends Component<ResponderAnchorState, Block> {
    public constructor(
        private readonly responder: MultiResponder,
        blockProcessor: BlockProcessor<Block>,
        private readonly confirmationsRequired: number
    ) {
        super(
            new MappedStateReducer<
                ResponderAppointmentAnchorState,
                Block,
                { id: string; queueItem: GasQueueItemRequest }
            >(
                () => [...this.responder.respondedTransactions.values()],
                item => new ResponderReducer(blockProcessor, item.queueItem, item.id)
            )
        );
    }

    public async handleNewStateEvent(
        prevHead: Block,
        prevState: ResponderAnchorState,
        head: Block,
        state: ResponderAnchorState
    ) {
        // TODO:198: sort out the names in the responder - sometimes we refer to the

        // TODO:198: what happens to errors in here? what should we do about them
        const isPending = (state: ResponderAppointmentAnchorState): state is PendingResponseState => {
            return state.kind === ResponderStateKind.Pending;
        };
        const hasBeenMined = (state: ResponderAppointmentAnchorState | undefined): state is MinedResponseState => {
            if (!state) return false;
            return state.kind === ResponderStateKind.Mined;
        };
        const shouldBeRemoved = (
            state: ResponderAppointmentAnchorState | undefined,
            block: Block
        ): state is MinedResponseState => {
            if (!state) return false;
            return (
                state.kind === ResponderStateKind.Mined && block.number - state.blockMined > this.confirmationsRequired
            );
        };

        this.responder.reEnqueueMissingItems([...state.values()].filter(isPending).map(q => q.queueItem));

        for (const appointmentId of state.keys()) {
            const prevItem = prevState.get(appointmentId);
            const currentItem = state.get(appointmentId);

            if (!hasBeenMined(prevItem) && hasBeenMined(currentItem)) {
                await this.responder.txMined(currentItem.identifier, currentItem.nonce, currentItem.from);
            }

            if (!shouldBeRemoved(prevItem, prevHead) && shouldBeRemoved(currentItem, head)) {
                await this.responder.endResponse(currentItem.appointmentId);
            }
        }
    }
}

export class MultiResponder extends EthereumResponder {
    public get queue() {
        return this.mQueue;
    }
    private mQueue: GasQueue;
    public readonly respondedTransactions: Map<string, { id: string; queueItem: GasQueueItemRequest }> = new Map();

    /**
     * Can handle multiple response for a given signer. This responder requires exclusive
     * use of the signer, as it carefully manages the nonces of the transactions created by
     * the signer. Can handle a concurrent number of responses up to maxQueueDepth
     * @param blockProcessor TODO:198: document this
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
    //TODO:198: documentation out of date - check everywhere in this file
    public constructor(
        readonly blockProcessor: BlockProcessor<Block>,
        public readonly address: string,
        public readonly startingNonce: number,
        public readonly signer: ethers.Signer,
        public readonly gasEstimator: GasPriceEstimator,
        public readonly chainId: number,
        maxConcurrentResponses: number = 12,
        replacementRate: number = 13
    ) {
        super(signer);
        if (replacementRate < 0) throw new ArgumentError("Cannot have negative replacement rate.", replacementRate);
        if (maxConcurrentResponses < 1) {
            throw new ArgumentError("Maximum concurrent requests must be greater than 0.", maxConcurrentResponses);
        }
        this.mQueue = new GasQueue([], startingNonce, replacementRate, maxConcurrentResponses);
        this.broadcast = this.broadcast.bind(this);
    }

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

    public async reEnqueueMissingItems(queueItems: GasQueueItemRequest[]) {
        // a reorg may have occurred, if this is the case then we need to check whether
        // then some transactions that we had previously considered mined may no longer
        // be. We can find these transactions by comparing the current gas queue to the
        // transactions that we currently observe in pending. Transactions in pending
        // but not in the gas queue need to be added there.

        const missingQueueItems: GasQueueItemRequest[] = [];

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
