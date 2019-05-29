import { Logger } from "winston";
import { ConfigurationError } from "./errors";
import { createNamedLogger } from "../logger";
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
     * Each service has its own Logger instance
     */
    protected logger: Logger;

    /**
     * A service that requires starting and stopping.
     * Whoever constructs this service must start it before using it.
     * Whoever constructs this service must stop it after using it.
     */
    protected constructor(protected readonly name: string) {
        super();

        this.logger = createNamedLogger(name);
    }
    private mStarted: boolean = false;
    public get started() {
        return this.mStarted;
    }
    private mStarting: boolean = false;

    /**
     * Start this service
     */
    public async start() {
        if (this.mStarted) throw new ConfigurationError(`${this.name}: Already started.`);
        if (this.mStarting) throw new ConfigurationError(`${this.name}: Currently starting.`);
        // set started straight away to block the code below
        this.mStarting = true;
        await this.startInternal();
        this.logger.info(`${this.name}: Started.`);
        this.mStarted = true;
        this.mStarting = false;
        this.emit(StartStopService.STARTED_EVENT);
    }
    protected abstract startInternal(): Promise<void>;

    /**
     * Stop this service
     */
    public async stop() {
        if (this.mStarted) {
            this.mStarted = false;
            await this.stopInternal();
            this.logger.info(`${this.name}: Stopped.`);
            this.emit(StartStopService.STOPPED_EVENT);
        } else {
            this.logger.error(`${this.name}: Already stopped.`);
        }
    }
    protected abstract stopInternal(): Promise<void>;
}
