import { BlockProcessor } from "./blockProcessor";
import { StartStopService } from "../dataEntities";

/**
 * Generates events when no new block is observed for too long, possibly signaling a malfunctioning of the provider.
 * The timer starts when the service is started, and is reset every time a new block is received.
 */
export class BlockTimeoutDetector extends StartStopService {
    private timeoutHandle: NodeJS.Timeout | null = null;

    /**
     * Emitted when a no new block is received for a time longer than the `timeout` milliseconds.
     */
    public static readonly BLOCK_TIMEOUT_EVENT = "no_new_block";

    /**
     * @param timeout The number of milliseconds without a new block before generating
     */
    constructor(private blockProcessor: BlockProcessor, public readonly timeout: number) {
        super("Block timeout detector");
        this.resetNoNewBlockTimeout = this.resetNoNewBlockTimeout.bind(this);
    }

    protected async startInternal(): Promise<void> {
        this.blockProcessor.on(BlockProcessor.NEW_HEAD_EVENT, this.resetNoNewBlockTimeout);
        this.resetNoNewBlockTimeout();
    }

    public async stopInternal(): Promise<void> {
        this.clearNoNewBlockTimeout();
        this.blockProcessor.off(BlockProcessor.NEW_HEAD_EVENT, this.resetNoNewBlockTimeout);
    }

    // Start the timer, after clearing any previous timer
    private resetNoNewBlockTimeout() {
        // If a timer is pending, cancel it
        this.clearNoNewBlockTimeout();
        const blockEventHandler = () => this.emit(BlockTimeoutDetector.BLOCK_TIMEOUT_EVENT);
        this.timeoutHandle = setTimeout(blockEventHandler, this.timeout);
    }

    // If a timer was active, clear it
    private clearNoNewBlockTimeout() {
        if (this.timeoutHandle !== null) {
            clearTimeout(this.timeoutHandle);
            this.timeoutHandle = null;
        }
    }
}
