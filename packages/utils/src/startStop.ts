import { ConfigurationError } from "@pisa-research/errors";
import { EventEmitter } from "events";
import { Logger } from ".";

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
     *
     * @param name The name of the service. It must contain lowercase letters, numbers and hyphens ("-").;
     * @param logger the Logger to use. The service will create a child from it.
     */
    protected constructor(protected readonly name: string, logger: Logger) {
        super();

        if (!/^[a-z0-9\-]+$/.test(name)) {
            throw new ConfigurationError(`"${name}" is not a valid service name: it must only contain lowercase letters, numbers and hyphens.`);
        }

        this.logger = logger.storedChild({ component: name });
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
        if (this.mStarted) throw new ConfigurationError("Already started.");
        if (this.mStarting) throw new ConfigurationError("Currently starting.");
        // set started straight away to block the code below
        this.mStarting = true;
        await this.startInternal();
        this.logger.info({ code: "p_service_started" }, "Started.");
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
            this.logger.info({ code: "p_service_stopped" }, "Stopped.");
            this.emit(StartStopService.STOPPED_EVENT);
        } else {
            this.logger.error({ code: "p_service_alreadystopped" }, "Already stopped.");
        }
    }
    protected abstract stopInternal(): Promise<void>;
}
