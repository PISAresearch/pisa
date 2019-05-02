import { ConfigurationError } from "./errors";
import logger from "../logger";
import { EventEmitter } from "events";

// TODO:113: move the tests for start stoppable elsewhere - off the gc
// TODO:113: document this class
export abstract class StartStopService extends EventEmitter {
    public static readonly STARTED_EVENT = "started";
    public static readonly STOPPED_EVENT = "stopped";

    constructor(protected readonly name: string) {
        super();
    }
    private mStarted: boolean = false;

    /**
     * Start this service
     */
    public start() {
        if (this.mStarted) throw new ConfigurationError(`${this.name}: Already started.`);
        this.startInternal();
        this.mStarted = true;
        logger.info(`${this.name}: Started.`);
        this.emit(StartStopService.STARTED_EVENT);
    }
    protected abstract startInternal();

    /**
     * Stop this service
     */
    public stop() {
        if (this.mStarted) {
            this.mStarted = false;
            this.stopInternal();
            logger.info(`${this.name}: Stopped.`);
            this.emit(StartStopService.STOPPED_EVENT);
        } else {
            logger.error(`${this.name}: Already stopped.`);
        }
    }
    protected abstract stopInternal();
}
