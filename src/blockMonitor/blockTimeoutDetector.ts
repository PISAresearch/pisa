import { BlockProcessor } from "./blockProcessor";
import { StartStopService } from "../dataEntities";

/**
 * Generates events when no new block is observed for too long, possibly signaling a malfunctioning of the provider.
 */
export class BlockTimeoutDetector extends StartStopService {
    private timeoutHandler: NodeJS.Timeout | null = null;

    /**
     * Emitted when a no new block is received for a time longer than the `noNewBlockTimeout` milliseconds.
     */
    public static readonly BLOCK_TIMEOUT_EVENT = "no_new_block";

    /**
     * @param timeout The number of milliseconds without a new block before generating
     */
    constructor(private blockProcessor: BlockProcessor, public readonly timeout: number) {
        super("Block timeout detector");
        this.handleNewBlock = this.handleNewBlock.bind(this);
    }

    protected startInternal(): void {
        this.blockProcessor.on(BlockProcessor.NEW_HEAD_EVENT, this.handleNewBlock);
        this.initNoNewBlockTimeout();
    }

    public stopInternal(): void {
        this.clearNoNewBlockTimeout();
        this.blockProcessor.off(BlockProcessor.NEW_HEAD_EVENT, this.handleNewBlock);
    }

    private initNoNewBlockTimeout() {
        // If a timer is pending, cancel it
        this.clearNoNewBlockTimeout();
        this.timeoutHandler = setTimeout(this.handleNoNewBlockTimeout, this.timeout);
    }

    private clearNoNewBlockTimeout() {
        if (this.timeoutHandler !== null) {
            clearTimeout(this.timeoutHandler);
            this.timeoutHandler = null;
        }
    }

    private handleNoNewBlockTimeout() {
        this.emit(BlockTimeoutDetector.BLOCK_TIMEOUT_EVENT);
    }

    private handleNewBlock() {
        this.initNoNewBlockTimeout();
    }
}
