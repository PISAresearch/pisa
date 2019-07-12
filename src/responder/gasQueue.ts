import { IEthereumResponseData, ArgumentError, ApplicationError } from "../dataEntities";
import { BigNumber } from "ethers/utils";
import { ethers } from "ethers";

export class PisaTransactionIdentifier {
    /**
     * Enough information for uniquely identify a pisa related transaction
     */
    constructor(
        public readonly chainId: number,
        public readonly data: string,
        public readonly to: string,
        public readonly value: BigNumber,
        public readonly gasLimit: BigNumber
    ) {}

    /**
     * Returns true iff all the properties of the two identifiers are equal
     * @param other
     */
    public equals(other: PisaTransactionIdentifier) {
        return (
            other.chainId === this.chainId &&
            other.data === this.data &&
            other.to === this.to &&
            other.value.eq(this.value) &&
            other.gasLimit.eq(this.gasLimit)
        );
    }
}

export class GasQueueItemRequest {
    /**
     * A request to a queue a transaction at a specified gas price.
     * @param identifier
     * @param idealGasPrice The minimum gas price at which this item should be submitted to the network
     * @param responseData The response data relevant to this request
     */
    constructor(
        public readonly appointmentId: string,
        public readonly identifier: PisaTransactionIdentifier,
        public readonly idealGasPrice: BigNumber,
        public readonly responseData: IEthereumResponseData
    ) {}
}

export class GasQueueItem {
    /**
     * A queued transaction
     * @param request
     * @param nonceGasPrice
     *      The gas price to be used at this nonce. Should always be greater
     *      than or equal to the ideal gas price.
     * @param idealGasPrice The minimum gas price at which this item should be submitted to the network
     * @param nonce The nonce which this item should be submitted at
     */
    constructor(
        public readonly request: GasQueueItemRequest,
        public readonly nonceGasPrice: BigNumber,
        public readonly idealGasPrice: BigNumber,
        public readonly nonce: number
    ) {
        if (nonceGasPrice.lt(idealGasPrice)) {
            throw new ArgumentError(
                "Current gas price cannot be less than ideal gas price",
                nonceGasPrice,
                idealGasPrice
            );
        }
    }

    /**
     * Convert this queue item to an ethereum transaction request
     */
    public toTransactionRequest(): ethers.providers.TransactionRequest {
        return {
            chainId: this.request.identifier.chainId,
            data: this.request.identifier.data,
            gasLimit: this.request.identifier.gasLimit,
            nonce: this.nonce,
            gasPrice: this.nonceGasPrice,
            to: this.request.identifier.to,
            value: this.request.identifier.value
        };
    }
}

export class GasQueue {
    /**
     * Items ordered by an ideal gas prices. Items in the queue
     * will always be ordered from highest ideal gas price to lowest ideal gas price.
     * They will also always be ordered by nonce ascending. This ensures that an item
     * with a high ideal gas price cannot get stuck behind an item with lower ideal
     * gas price.
     *
     * The queue can rearrange the order of transactions, however when it
     * picks a different item to use the same nonce as a previous item it must increase
     * current gas price of that item by at least the replacement rate, since a nonce
     * cannot be replaced with a different transaction without increasing the gas price
     *  by this amount
     * @param queueItems The items to put in the queue - must already be ordered correctly
     * @param emptyNonce
     *      The next empty nonce. Must equal the last queue item nonce + 1
     *      if any queue items exists
     * @param replacementRate
     *      The amount by which the current gas price of a transaction must be greater than
     *      an existing transaction if it is to replace it. Expresses as an integer pertange eg
     *      increase by 13 percent = 13
     * @param maxQueueDepth The maximum possible number of items that can be put into this queue
     */
    public constructor(
        public readonly queueItems: ReadonlyArray<GasQueueItem>,
        public readonly emptyNonce: number,
        public readonly replacementRate: number,
        public readonly maxQueueDepth: number
    ) {
        if (replacementRate < 1) throw new ArgumentError("Replacement rate should be positive.", replacementRate);
        if (emptyNonce < 0) throw new ArgumentError("Nonce must not be negative.", emptyNonce);
        if (maxQueueDepth < 1) throw new ArgumentError("Max queue depth must be greater than 0.", maxQueueDepth);

        if (queueItems.length > 1) {
            // check the integrity of the queue
            for (let index = 1; index < queueItems.length; index++) {
                const prevItem = queueItems[index - 1];
                const item = queueItems[index];
                if (item.idealGasPrice.gt(prevItem.idealGasPrice)) {
                    throw new ArgumentError(
                        "Ideal gas price of queue item was greater than the previous item.",
                        queueItems
                    );
                }
                if (item.nonce !== prevItem.nonce + 1) {
                    throw new ArgumentError("Nonce of queue item did not increase by one.", queueItems);
                }

                if (queueItems.find((q, i) => q.request.identifier.equals(item.request.identifier) && i !== index)) {
                    throw new ArgumentError("Identifier found twice in queue.", item.request.identifier, queueItems);
                }
            }
        }
        if (queueItems.length > 0 && queueItems[queueItems.length - 1].nonce + 1 !== emptyNonce) {
            throw new ArgumentError(
                "Empty nonce is not equal to the last queue item nonce plus one.",
                queueItems,
                emptyNonce
            );
        }
        if (this.queueItems.length > this.maxQueueDepth) {
            throw new ArgumentError(`Cannot create queue. Max queue depth of ${this.maxQueueDepth} reached.`);
        }
    }

    public depthReached() {
        return this.queueItems.length >= this.maxQueueDepth;
    }

    private getReplacementGasPrice(currentGasPrice: BigNumber, replacementRate: number) {
        const rRate = new BigNumber(replacementRate).add(100);
        // we add 99 here to ensure that we round up.
        return currentGasPrice
            .mul(rRate)
            .add(99)
            .div(100);
    }

    private cloneQueueItems() {
        return ([] as ReadonlyArray<GasQueueItem>).concat(this.queueItems);
    }

    /**
     * Uses the empty nonce to create a queue item and append it to the queue.
     * Modifies the queue.
     * @param queueItems
     * @param request
     */
    private append(queueItems: GasQueueItem[], request: GasQueueItemRequest) {
        const queueItem = new GasQueueItem(request, request.idealGasPrice, request.idealGasPrice, this.emptyNonce);
        queueItems.push(queueItem);
    }

    /**
     * Take a subset of the array and shift it to the right by one - towards higher index values.
     * The queue item at endIndex + 1 will be overwritten.
     * Modifies the supplied array.
     * @param queueItems
     * @param startIndex
     * @param endIndex
     */
    private shiftRight(queueItems: GasQueueItem[], startIndex: number, endIndex: number) {
        if (startIndex > endIndex) {
            throw new ArgumentError("Start index must be less than or equal end index.", startIndex, endIndex);
        }
        if (endIndex > queueItems.length - 1) {
            throw new ArgumentError("Index out of bounds: endIndex.", endIndex, queueItems.length);
        }
        if (startIndex < 0) throw new ArgumentError("Start index cannot be less than zero.", startIndex);

        for (let queueIndex = endIndex; queueIndex >= startIndex; queueIndex--) {
            const previousItemRequest = queueItems[queueIndex].request;
            const nextIndex = queueIndex + 1;
            // replace if we're not at the end of the array
            if (nextIndex !== queueItems.length) this.replace(queueItems, nextIndex, previousItemRequest);
            // but if we are at the end we can append without replacing
            else this.append(queueItems, previousItemRequest);
        }
    }

    /**
     * Replace an item at an index in the queue, with an new item created from the request
     * Increases the gas price by the replacement rate if necessary.
     * The queue will be modified.
     * @param queueItems
     * @param index The index of the item to replace
     * @param request The new request to replace the item at the current index
     */
    private replace(queueItems: GasQueueItem[], index: number, request: GasQueueItemRequest) {
        if (queueItems.length === 0) throw new ArgumentError("Cannot replace in empty queue.", queueItems.length);
        if (index < 0 || index > queueItems.length - 1) {
            throw new ArgumentError("Index out of range", index, queueItems.length - 1);
        }

        const replacementItem = queueItems[index];
        const nonce = replacementItem.nonce;
        const replacementPrice = this.getReplacementGasPrice(replacementItem.nonceGasPrice, this.replacementRate);
        // we can only replace an item with another one which has gas price at least
        // equal to an increase by the replacement rate on the current gas price. If
        // the request gas price is greater than this replaced price, we use that, otherwise
        // we need to increase to the replaced gas price
        const newGasPrice = replacementPrice.gt(request.idealGasPrice) ? replacementPrice : request.idealGasPrice;

        queueItems[index] = new GasQueueItem(request, newGasPrice, request.idealGasPrice, nonce);
    }

    /**
     * Add an item to the queue. Append to the end if this request has the lowest
     * ideal gas price, or insert in the middle of it has a higher ideal gas price.
     * If an insert occurs, transactions with lower gas price will have to be bumped
     * down the queue, and in doing so will have to be replaced on the network.
     * @param request
     */
    public add(request: GasQueueItemRequest): GasQueue {
        if (this.depthReached()) {
            throw new ArgumentError(`Cannot add item. Max queue depth reached.`, this.maxQueueDepth);
        }

        // starting from the highest gas price, look for the first tx
        // with ideal gas price less than the supplied one
        const foundTxIndex = this.queueItems.findIndex(indexedTx => request.idealGasPrice.gt(indexedTx.idealGasPrice));
        const clonedArray = this.cloneQueueItems();

        // if we didnt find a matching tx that means we're adding to the end of the queue
        // otherwise insert at the nonce point
        if (foundTxIndex !== -1) {
            // to insert we shift right everything after the index to make a space
            // then replace at the index
            this.shiftRight(clonedArray, foundTxIndex, clonedArray.length - 1);
            this.replace(clonedArray, foundTxIndex, request);
        } else {
            this.append(clonedArray, request);
        }

        return new GasQueue(clonedArray, this.emptyNonce + 1, this.replacementRate, this.maxQueueDepth);
    }

    /**
     * Dequeue the item in the queue which matches the supplied nonce, then shift
     * everything before this to upwards to remove the lowest nonce from the queue
     * @param nonce
     */
    public consume(identifier: PisaTransactionIdentifier) {
        const index = this.queueItems.findIndex(i => identifier.equals(i.request.identifier));
        if (index === -1) throw new ArgumentError("Identifier not found in queue.", identifier);
        const clonedArray = this.cloneQueueItems();
        // shift right the range to consume the item at the index
        // then remove the front of the queue
        this.shiftRight(clonedArray, 0, index - 1);
        clonedArray.shift();
        return new GasQueue(clonedArray, this.emptyNonce, this.replacementRate, this.maxQueueDepth);
    }

    /**
     * Removes and item from the front of the queue
     */
    public dequeue(): GasQueue {
        const clonedArray = this.cloneQueueItems();
        clonedArray.shift();
        return new GasQueue(clonedArray, this.emptyNonce, this.replacementRate, this.maxQueueDepth);
    }

    /**
     * Returns all queue items that are in this queue but not in the supplied queue
     * @param otherQueue
     */
    public difference(otherQueue: GasQueue): GasQueueItem[] {
        return this.queueItems.filter(tx => !otherQueue.queueItems.includes(tx));
    }

    /**
     * Checks to see if this queue contains an item with the supplied identifier
     * @param queueItem
     */
    public contains(identifier: PisaTransactionIdentifier): boolean {
        return this.queueItems.findIndex(i => i.request.identifier.equals(identifier)) !== -1;
    }

    
    /**
     * Re-add some items that have lower nonces than any in the current queue
     * @param lowerNonceItems 
     */
    public unlock(lowerNonceItems: GasQueueItem[]): GasQueue {
        // a correct queue is ordered by both nonce and ideal gas price
        // We'll need to adjust the nonces of queue items to ensure this
        const allItemsOrderedByNonce = lowerNonceItems.concat(this.queueItems).sort((a, b) => a.nonce - b.nonce);

        const allItemsByIdealGas = [...allItemsOrderedByNonce].sort((a, b) => {
            if (a.idealGasPrice.gt(b.idealGasPrice)) return -1;
            else if (a.idealGasPrice.eq(b.idealGasPrice)) return 0;
            else return 1;
        });

        for (let index = 0; index < allItemsByIdealGas.length; index++) {
            const itemOrderedByGas = allItemsByIdealGas[index];
            const itemOrderedByNonce = allItemsOrderedByNonce[index];

            // if there's a difference in the items then we have a difference in
            // order. We replace the item with the gas ordered one so that we have
            // all items ordered by gas price, and by nonce.
            if (itemOrderedByGas !== itemOrderedByNonce) {
                this.replace(allItemsOrderedByNonce, index, itemOrderedByGas.request);
            }
        }

        // all items ordered by nonce are now also ordered by gas price
        return new GasQueue(allItemsOrderedByNonce, this.emptyNonce, this.replacementRate, this.maxQueueDepth);
    }

    public getItem(request: GasQueueItemRequest) {
        const queueItem = this.queueItems.find(q => q.request === request);
    }
}
