import { StartStopService, ArgumentError } from "../dataEntities";
import { BlockProcessor } from "./blockProcessor";
import { BlockCache } from "./blockCache";
import { CancellablePromise } from "../utils";

interface ITransactionListenerResolver {
    txHash: string;
    resolver: () => void;
    confirmationsRequired: number;
}
/**
 * Allows to observe transactions to be notified when they reach a given number of confirmations.
 */
export class ConfirmationObserver extends StartStopService {
    private txListenerResolvers = new Set<ITransactionListenerResolver>();

    constructor(private readonly blockCache: BlockCache, private readonly blockProcessor: BlockProcessor) {
        super("Confirmation Observer");
        this.handleNewHead = this.handleNewHead.bind(this);
    }

    protected async startInternal() {
        this.blockProcessor.on(BlockProcessor.NEW_HEAD_EVENT, this.handleNewHead);
    }

    protected async stopInternal() {
        this.blockProcessor.removeListener(BlockProcessor.NEW_HEAD_EVENT, this.handleNewHead);
    }

    private handleNewHead(blockNumber: number, blockHash: string) {
        // Make a copy of the listenerResolvers
        const txListenerResolversCopy = new Set(this.txListenerResolvers);

        // Verify for each waiting transaction, verify if the number of confirmations was reached.
        // Note: this is relatively inefficient if there are many listeners, as it does O(maxDepth) work per listener.
        for (let listenerResolver of txListenerResolversCopy) {
            const { txHash, confirmationsRequired, resolver } = listenerResolver;
            if (this.blockCache.getConfirmations(blockHash, txHash) >= confirmationsRequired) {
                this.txListenerResolvers.delete(listenerResolver);
                resolver();
            }
        }
    }

    public waitForConfirmations(txHash: string, confirmationsRequired: number): CancellablePromise<void> {
        const listenerResolver: ITransactionListenerResolver = {
            txHash,
            confirmationsRequired,
            resolver: () => {} // temporary, will be overwritten
        };

        const canceller = () => this.txListenerResolvers.delete(listenerResolver);

        return new CancellablePromise(async (resolve, reject) => {
            if (confirmationsRequired > this.blockCache.maxDepth) {
                reject(new ArgumentError("confirmationRequired cannot be bigger than the BlockCache's maxDepth."));
            }

            if (this.blockCache.getConfirmations(this.blockProcessor.head!.hash, txHash) >= confirmationsRequired) {
                // Already has enough confirmations, resolve immediately
                resolve();
            } else {
                // Add to the listeners to be resolved in the future
                listenerResolver.resolver = resolve;
                this.txListenerResolvers.add(listenerResolver);
            }
        }, canceller);
    }
}
