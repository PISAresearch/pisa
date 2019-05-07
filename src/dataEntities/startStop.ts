import { ConfigurationError } from "./errors";
import logger from "../logger";
import { EventEmitter } from "events";

/**
 * A service that requires starting and stopping.
 * Always start this service before using it.
 * Always stop this service when finished with it.
 */
export abstract class StartStopService extends EventEmitter {
    /**
     * Emitted when the service is started
     */
    public static readonly STARTED_EVENT = "started";

    /**
     * Emitted when the service is stopped
     */
    public static readonly STOPPED_EVENT = "stopped";

    protected constructor(protected readonly name: string) {
        super();
    }
    private mStarted: boolean = false;

    /**
     * Start this service
     */
    public async start() {
        if (this.mStarted) throw new ConfigurationError(`${this.name}: Already started.`);
        await this.startInternal();
        this.mStarted = true;
        logger.info(`${this.name}: Started.`);
        this.emit(StartStopService.STARTED_EVENT);
    }
    protected abstract startInternal(): void;

    /**
     * Stop this service
     */
    public async stop() {
        if (this.mStarted) {
            this.mStarted = false;
            await this.stopInternal();
            logger.info(`${this.name}: Stopped.`);
            this.emit(StartStopService.STOPPED_EVENT);
        } else {
            logger.error(`${this.name}: Already stopped.`);
        }
    }
    protected abstract stopInternal(): void;
}
