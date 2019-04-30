import { ConfigurationError } from "./errors";
import logger from "../logger";


// TODO:113: move the tests for start stoppable elsewhere
// TODO:113: document this class
// TODO:113: move this class elsewhere
export abstract class StartStoppable {
    constructor(private readonly name: string) {}
    private mStarted: boolean;
    protected get started() {
        return this.mStarted;
    }
    protected set started(value) {
        this.mStarted = value;
    }

    /**
     * Start this service
     */
    public async start() {
        if (this.started) throw new ConfigurationError(`${this.name}: Already started.`);
        await this.startInternal();
        this.started = true;
        logger.info(`${this.name}: Started.`);
    }
    protected abstract async startInternal();

    /**
     * Stop this service
     */
    public async stop() {
        if (this.started) {
            this.started = false;
            await this.stopInternal();
            logger.info(`${this.name}: Stopped.`);
        } else {
            logger.error(`${this.name}: Already stopped.`);
        }
    }
    protected abstract async stopInternal();
}