import { ArgumentError, IEthereumResponseData } from "../dataEntities";
import { EthereumTransactionMiner, EthereumResponder } from "../responder";
import { ethers } from "ethers";

// A replaced transaction will not be accepted unless it increases the cost by > 10-15% (this is a configurable value, so it's possible that some nodes won't allow replacement at all). I'll call this the replacement rate

// First strategy - no batching:
// The responder maintains a queue of transactions, ordered by nonce ascending. They are also always ordered by gas price descending, such that the lowest nonce transaction will always have the highest gas price. This will prevent higher gas price transactions waiting for lower gas price ones.

// When a new transaction arrives:

// According to its gas price, find what nonce it should have in the queue
// For all transactions where nonce >= incomingTx.nonce, ordered by nonce ascending
// a) increase the nonce by one
// b) check the gas price of transaction at nonce + 1. Then set tx[i].gasPrice := max((1 + replacement rate) * tx[i - i].gasPrice, tx[i].gasPrice).
// c) set the gas price to be set the gas price of the incoming tx in the same way.
// All transactions that have ever been passed to the network must be monitored for until a tx is mined with that nonce, even ones considered replaced. Since it is technically possible for any of these to get mined, and in any order (only nonce order is guaranteed).

class MultiResponder {
    private queue: TransactionQueue;

    constructor(
        private readonly transactionMiner: EthereumTransactionMiner,
        replacementRate: number,
        accountNonce: number,
        private readonly signer: ethers.Signer
    ) {
        this.queue = new TransactionQueue([], accountNonce, replacementRate);
    }

    /**
     * Creates the transaction request to be sent to handle the response in `resposeData`.
     *
     * @param responseData the response data used to create the transaction
     * @param nonce The nonce to be used.
     */
    protected prepareTransactionRequest(
        responseData: IEthereumResponseData,
        nonce: number,
        gasPrice: number
    ): ethers.providers.TransactionRequest {
        // form the interface so that we can serialise the args and the function name
        const abiInterface = new ethers.utils.Interface(responseData.contractAbi);
        const data = abiInterface.functions[responseData.functionName].encode(responseData.functionArgs);
        // now create a transaction, specifying possible oher variables
        return {
            to: responseData.contractAddress,
            gasLimit: EthereumResponder.GAS_LIMIT,
            nonce,
            gasPrice,
            data
        };
    }

    public respond(responseData: IEthereumResponseData) {
        const unsubmittedTx = new UnsubmittedTx()
        

        const replacedQueue = this.queue.add(tx);

        // find the difference between these two queues, and broadcast those transactions
        const replacedTransactions = replacedQueue.difference(this.queue);
        // we're done with the old queue
        this.queue = replacedQueue;

        for (const tx of replacedTransactions) {
            // we dont need to await these
            this.broadcastTx(tx);
        }
    }

    private async broadcastTx(tx: Tx) {
        try {
            // we just want to broad cast here we dont need to wait for a confirmation
            // once we've broadcast we'll pass that over to a different service to keep watching?
            await this.transactionMiner.sendTransaction({});
        } catch (error) {}
    }
}

class UnsubmittedTx {
    public constructor(readonly priority: number) {}
}

class Tx extends UnsubmittedTx {
    public constructor(public readonly nonce: number, public readonly currentGasPrice: number, priority: number) {
        super(priority);
    }
}

// An ordered list of the response currently in flight - or waiting for more confirmations?

// gas prices
class TransactionQueue {
    constructor(
        public readonly transactions: ReadonlyArray<Tx>,
        // TODO:174: we use this because there may not be any transaction to begin with
        public readonly nextUnusedNonce: number,
        public readonly replacementRate: number
    ) {}

    // TODO: 174: decide whether to keep these functions
    private getPriorityNonce(txs: ReadonlyArray<Tx>, tx: UnsubmittedTx) {
        const foundTx = txs.find(indexedTx => tx.priority > indexedTx.priority);
        return !foundTx ? null : foundTx.nonce;
    }

    private getIdealGasPrice(priority: number): number {
        throw new Error("not implemented");
    }

    private getReplacementGasPrice(currentGasPrice: number, replacementRate: number) {
        return currentGasPrice * replacementRate;
    }

    public append(tx: UnsubmittedTx) {
        const submittedTx = new Tx(this.nextUnusedNonce, this.getIdealGasPrice(tx.priority), tx.priority);

        // clone the incoming array
        const clonedArray = ([] as ReadonlyArray<Tx>).concat(this.transactions);
        clonedArray.push(submittedTx);
        return new TransactionQueue(clonedArray, this.nextUnusedNonce + 1, this.replacementRate);
    }

    public splice(tx: UnsubmittedTx, nonce: number) {
        const index = this.transactions.findIndex(t => t.nonce === nonce);
        if (index === -1) throw new ArgumentError("nonce not found in queue", nonce);

        // insert the new tx
        const clonedArray = ([] as ReadonlyArray<Tx>).concat(this.transactions);
        clonedArray.splice(index, 0, new Tx(clonedArray[index].nonce, this.getIdealGasPrice(tx.priority), tx.priority));

        // now bump up later txs - there will always be at least one tx to bump
        for (let queueIndex = index; queueIndex < this.transactions.length; queueIndex++) {
            const tx = this.transactions[queueIndex];
            const nextTx = this.transactions[queueIndex + 1];

            // bump the gas price is necessary
            const newGasPrice = !nextTx
                ? // if there is no next tx then we're moving into a free nonce and no gas price comparison
                  // wil be required, just choose the current gas price
                  tx.currentGasPrice
                : // otherwise compare the current gas price with the one required to replace the
                  // next tx, we need to choose the maximum of these two
                  Math.max(
                      tx.currentGasPrice,
                      this.getReplacementGasPrice(nextTx.currentGasPrice, this.replacementRate)
                  );

            // increment the nonce
            const newNonce = tx.nonce + 1;
            // update the array
            clonedArray[queueIndex + 1] = new Tx(newNonce, newGasPrice, tx.priority);
        }

        return new TransactionQueue(clonedArray, this.nextUnusedNonce + 1, this.replacementRate);
    }

    public add(tx: UnsubmittedTx): TransactionQueue {
        const nonce = this.getPriorityNonce(this.transactions, tx);
        // if we didnt find a nonce that means we're adding to the end of the queue
        // otherwise insert at the nonce point
        return nonce === null ? this.append(tx) : this.splice(tx, nonce);
    }

    public difference(queue: TransactionQueue) {
        return this.transactions.filter(tx => !queue.transactions.includes(tx));
    }
}
