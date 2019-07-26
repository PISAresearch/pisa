import { Logger } from "winston";
import { ApplicationError, ConfigurationError } from "./errors";
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
     *
     * @param name The name of the service. It must contain lowercase letters, numbers and hyphens ("-").;
     */

    protected callsLog : string[] = [];
    protected constructor(protected readonly name: string) {
        super();
        let instance = this;

        /**
        * protected methods are:
        * construct (= constructor) ; startInternal; stopInternal; start; stop
        * They, and their internals, can use public methods without start having yet been called.
        */
        function asProtectedMethod (target: any, prop: string) {
            return function (...args: any[]) {
                instance.suppressNotStartedError++;
                // This could better be a warn, for debugging.
                if (instance.suppressNotStartedError >=2)
                    throw new Error (`Multiple (${instance.suppressNotStartedError}) protected methods suppressing the NotStartedError on ${instance.constructor.name}`)
                const result = target[prop].apply(instance, args);
                instance.suppressNotStartedError--;
                return result;
            };
        }

        let proxyHandler = {
            construct (target: any, prop: string) {
                throw new ApplicationError ("StartStopService was instantiated without inheriting.")
                // return asProtectedMethod (target, prop) ();
            },

            /**
            * If method called is a protected one (or is constructor), return the requested function, though wrapped in
            * checking/ setting of the appropriate flag to avoid errors in the functions contained calls to public methods.
            * If method called is a public one, return the unmodified function as normal only if
            * that flag is set or service is started - else error.
            **/
            get (target: any, prop: string, receiver: any) {
                // Do not intercept these
                if (typeof target[prop] !== "function" || prop==="start" || prop==="stop")
                    return target[prop];

                if (prop==="startInternal" || prop==="stopInternal")
                    return asProtectedMethod (target, prop);

                // NB check if the second test is shortcircuited - test >0 is correct.
                if (instance.mStarted || (instance.suppressNotStartedError >0) )
                    return target[prop];

                throw new ApplicationError ("Service not started.");
            }
        };

        if (!/^[a-z0-9\-]+$/.test(name)) {
            throw new ConfigurationError(
                `"${name}" is not a valid service name: it must only contain lowercase letters, numbers and hyphens.`
            );
        }

        this.logger = createNamedLogger(name);
        return new Proxy(this,proxyHandler);
    }
    private mStarted: boolean = false;
    public get started() {
        return this.mStarted;
    }
    private mStarting: boolean = false;
    private suppressNotStartedError: number = 0;

    /**
     * Start this service
     */
    public async start() {
        if (this.mStarted) throw new ConfigurationError("Already started.");
        if (this.mStarting) throw new ConfigurationError("Currently starting.");
        // set started straight away to block the code below
        this.mStarting = true;
        await this.startInternal();
        this.logger.info("Started.");
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
            this.logger.info("Stopped.");
            this.emit(StartStopService.STOPPED_EVENT);
        } else {
            this.logger.error("Already stopped.");
        }
    }
    protected abstract stopInternal(): Promise<void>;
}
