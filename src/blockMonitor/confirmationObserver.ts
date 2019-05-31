import { StartStopService, ArgumentError, BlockThresholdReachedError, ReorgError } from "../dataEntities";
import { BlockProcessor } from "./blockProcessor";
import { BlockCache } from "./blockCache";
import { CancellablePromise, cancellablePromiseRace } from "../utils";

// A TransactionListener fulfills/rejects a promise if possible; returns true on success
type TransactionListener = (blockNumber: number, blockHash: string) => boolean;

/**
 * Allows to observe transactions to be notified when they reach a given number of confirmations.
 */
export class ConfirmationObserver extends StartStopService {
    private txListeners = new Set<TransactionListener>();

    constructor(private readonly blockCache: BlockCache, private readonly blockProcessor: BlockProcessor) {
        super("confirmation-observer");
        this.handleNewHead = this.handleNewHead.bind(this);
    }

    protected async startInternal(): Promise<void> {
        this.blockProcessor.on(BlockProcessor.NEW_HEAD_EVENT, this.handleNewHead);
    }

    protected async stopInternal(): Promise<void> {
        this.blockProcessor.removeListener(BlockProcessor.NEW_HEAD_EVENT, this.handleNewHead);
    }

    private handleNewHead(blockNumber: number, blockHash: string) {
        // Execute each listener, remove the ones that are completed
        for (const listener of this.txListeners) {
            if (listener(blockNumber, blockHash) === true) {
                this.txListeners.delete(listener);
            }
        }
    }

    private listenForPredicate<T>(predicate: TransactionListener): CancellablePromise<T> {
        const createResolvingPredicate = (resolve: () => void) => (blockNumber: number, blockHash: string): boolean => {
            const result = predicate(blockNumber, blockHash);
            if (result) resolve();
            return result;
        };

        let resolvingPredicate: TransactionListener;
        return new CancellablePromise(
            resolve => {
                resolvingPredicate = createResolvingPredicate(resolve);
                this.txListeners.add(resolvingPredicate);
            },
            () => this.txListeners.delete(resolvingPredicate)
        );
    }

    /**
     * Generates a CancellablePromise that resolves when the transaction with hash `txHash` obtained at least
     * `nConfirmations` confirmations.
     *
     * @param txHash
     * @param nConfirmations
     **/
    public waitForConfirmations(txHash: string, nConfirmations: number): CancellablePromise<void> {
        if (nConfirmations > this.blockCache.maxDepth) {
            return new CancellablePromise((_, reject) =>
                reject(new ArgumentError("nConfirmations cannot be bigger than the BlockCache's maxDepth."))
            );
        }

        const headHash = this.blockProcessor.head && this.blockProcessor.head.hash;
        if (headHash && this.blockCache.getConfirmations(headHash, txHash) >= nConfirmations) {
            // already has enough confirmations, resolve immediately
            return new CancellablePromise(resolve => resolve());
        }

        return this.listenForPredicate(
            (_, blockHash) => this.blockCache.getConfirmations(blockHash, txHash) >= nConfirmations
        );
    }

    /**
     * Returns a `CancellablePromise` that resolves as soon as at least `nBlock` new blocks are mined.
     **/
    public waitForBlocks(nBlocks: number) {
        // store the current height, or null if not known (will be set later);
        let initialHeight = this.blockProcessor.head && this.blockProcessor.head.number;

        return this.listenForPredicate((blockNumber, _) => {
            if (initialHeight === null) {
                // initial height not known, set it now for next time
                initialHeight = blockNumber;
            }
            return blockNumber >= initialHeight + nBlocks;
        });
    }

    /**
     * Returns a `CancellablePromise` that resolves as soon as the transaction with hash `txHash` is found to have 0 confirmations.
     * If the transaction previously had at least 1 confirmation, this signals that a re-org occurred that kicked the transaction out.
     **/
    public waitForConfirmationsToGoToZero(txHash: string) {
        // listen on each block to see if the confirmations for this block go to zero
        return this.listenForPredicate((_, blockHash) => this.blockCache.getConfirmations(blockHash, txHash) === 0);
    }

    /**
     * Returns a `CancellablePromise` that resolves when the transaction with hash `txHash` obtained the first
     * confirmation, but throws a `BlockThresholdReachedError` if  `blockThreshold` new blocks are mined and the
     * transaction is still unconfirmed.
     */
    public waitForFirstConfirmationOrBlockThreshold(txHash: string, blockThreshold: number): CancellablePromise<{}> {
        const confirmationsPromise = this.waitForConfirmations(txHash, 1);
        const blockThresholdPromise = this.waitForBlocks(blockThreshold);
        const blockThresholdPromiseThrow = blockThresholdPromise.then(() => {
            throw new BlockThresholdReachedError("Block threshold reached");
        });

        const res = cancellablePromiseRace(
            [confirmationsPromise, blockThresholdPromiseThrow],
            [confirmationsPromise, blockThresholdPromise]
        );
        return res;
    }

    /**
     * Returns a CancellablePromise that resolves when the transaction with hash `txHash` obtained at least
     * `nConfirmations` confirmations, but throws a ReorgError if the transaction is not found.
     * It is the responsibility of the caller to make sure that previously had at least 1 confirmation.
     */
    public waitForConfirmationsOrReorg(txHash: string, nConfirmations: number) {
        const confirmationsPromise = this.waitForConfirmations(txHash, nConfirmations);
        const zeroConfirmationsPromise = this.waitForConfirmationsToGoToZero(txHash);
        const zeroConfirmationsPromiseThrow = zeroConfirmationsPromise.then(() => {
            throw new ReorgError("There could have been a re-org, the transaction was sent but was later not found");
        });

        return cancellablePromiseRace(
            [confirmationsPromise, zeroConfirmationsPromiseThrow],
            [confirmationsPromise, zeroConfirmationsPromise]
        );
    }
}
