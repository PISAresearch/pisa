import { ConfigurationError } from "./errors";
import logger from "../logger";
import { EventEmitter } from "events";

/**
 * A service that requires starting and stopping.
 * Whoever constructs this service must start it before using it.
 * Whoever constructs this service must stop it after using it.
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

    /**
     * A service that requires starting and stopping.
     * Whoever constructs this service must start it before using it.
     * Whoever constructs this service must stop it after using it.
     */
    protected constructor(protected readonly name: string) {
        super();
    }
    private mStarted: boolean = false;
    private mStarting: boolean = false;

    /**
     * Start this service
     */
    public async start() {
        if (this.mStarted) throw new ConfigurationError(`${this.name}: Already started.`);
        if (this,this.mStarting) throw new ConfigurationError(`${this.name}: Currently starting.`);
        // set started straight away to block the code below
        this.mStarting = true;
        await this.startInternal();
        logger.info(`${this.name}: Started.`);
        this.mStarted = true;
        this.mStarting = false;
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
