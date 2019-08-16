import { ApplicationError, ConfigurationError } from "./errors";
import { createNamedLogger, Logger } from "../logger";
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

    protected logVerbosityOfNotStartedError: number = 0;

    /**
     * A service that requires starting and stopping.
     * Whoever constructs this service must start it before using it.
     * Whoever constructs this service must stop it after using it.
     *
     * @param name The name of the service. It must contain lowercase letters, numbers and hyphens ("-").;
     */

    protected constructor(protected readonly name: string) {
        super();
        let instance = this;

        function detailsOfNotStartedError (instance: any, prop : string) :string {
            if (instance.logVerbosityOfNotStartedError) {
                let message : string = `    `;
                message += `\n  Attempt was: ${instance.constructor.name}.${prop}`;
                if (instance.mStarted || instance.suppressNotStartedError)
                    message += `\n  start states are: .mStarted: ${instance.mStarted}, called internally: ${instance.suppressNotStartedError>1 ? instance.suppressNotStartedError : !!instance.suppressNotStartedError}`
                if (instance.callsLog.length>1)
                    message += `\n  Previous get chain on instance was: ${instance.callsLog.join('; ')}`;
                else
                    message += `\n  No previous calls on this instance` ;
                if (instance.callsLog.indexOf(' start') ===-1)
                    message += `\n  Cannot find any previous call to start`;
                if (instance.callsLog.indexOf(' stop') >-1)
                    message += `\n  Found call to stop, previous to this call`;
                return message;
            }
            return '';
        };

        let proxyHandler = {
            construct (target: any, prop: string) {
                throw new Error ('Should not have reached here! (startStopService.construct)');
                // return asProtectedMethod (target[prop]) ();
            },

            /**
            * If method called is a protected one, return the requested function, though wrapped in
            * checking/ setting of the appropriate flag to avoid errors in the functions contained calls to public methods.
            * If method called is a public one, return the unmodified function as normal only if
            * that flag is set or service is started - else error.
            **/
            get (target: any, prop: string) {

                /**
                * protected methods are:
                * startInternal; stopInternal; start; stop; They, and their internals, can use public methods without start having yet been called.
                * For constructors, a different means is used to detect whether the requested method is called below a constructor.
                * This function is NOT safe for general use, eg for constructors, as it does not return the return value of the
                * wrapped function (due to async / await complexity).
                */
                function asProtectedMethod (targetMethod : Function) {
                    return async function (...args: any[]) {
                        instance.suppressNotStartedError++;
                        await targetMethod.apply(this, args);
                        instance.suppressNotStartedError--;
                        // we return nothing here (or, rather an empty Promise)
                    };
                }

                /**
                 *  Throws, since it is currently only called when, otherwise, a notStarted Error would be reached.
                 *  Unreachable return behaviour is to allow for turning the error on/ off
                **/
                function logOnOffEvents (targetMethod : Function) {
                    return function (...args: any[]) {
                        if (instance.logVerbosityOfNotStartedError)
                            instance.callsLog.push (` "${args[0].toString()}"`);
                        throw new ApplicationError (`Service not started.\n${detailsOfNotStartedError (instance, 'on/off')}`);
                        const result = targetMethod.apply(this, args);
                        return result;
                    };
                }

                /* relies on error.stack which is still stage 1. In particular some JSs will not set it at construction of Error
                 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/stack
                 * Unfortunately Function.caller is also non-standard and when standardised will be overly restrictive
                 * https://tc39.es/ecma262/#sec-forbidden-extensions
                 * And arguments.callee.caller is deprecated.
                 */
                function isWithinConstructor () : boolean {
                    const anyErr : {[k: string]: any} = new Error;
                    // this means notStartedError will never throw when run in JS not supporting Error.stack (or not setting stack on new Error).
                    if (!anyErr.hasOwnProperty('stack'))
                        return true;
                        // throw new ApplicationError (`Tried to access new Error.stack, but not found. Maybe your JS doesn't support it`);
                    const ownClassHallmark : string = `at new ${instance.constructor.name}`;
                    const spyHallmark : string = `at new Spy`;
                    const stack : string = anyErr.stack;
                    return (stack.indexOf(ownClassHallmark) > -1 || stack.indexOf(spyHallmark) > -1);
                };

                if (instance.logVerbosityOfNotStartedError) {
                    let toLog : string = '';
                    if (instance.suppressNotStartedError)
                          toLog += `(${instance.suppressNotStartedError})`;
                    toLog += ` ${prop}`;
                    if (isWithinConstructor())
                          toLog +=  ` (within constructor of ${instance.constructor.name})`;
                    instance.callsLog.push (toLog);
                }

                // Do not intercept these
                if (typeof target[prop] !== 'function' || prop==='asProtectedMethod')
                    return target[prop];

                if (prop==='start' || prop==='stop' || prop==='startInternal' || prop==='stopInternal')
                    return asProtectedMethod (target[prop]);

                if (instance.mStarted || (instance.suppressNotStartedError >0) )
                    return target[prop];

                // Temporary - remove this!
                const knownErrorsWillBeFixed = ['addComponent',''];
                if (knownErrorsWillBeFixed.indexOf(prop) > -1)
                    return target[prop];

                if (isWithinConstructor())
                    return target[prop];

                if ((instance.logVerbosityOfNotStartedError >= 4) && (prop==="on" || prop==="off"))
                    return logOnOffEvents (target[prop]);

                throw new ApplicationError (`Service not started.${detailsOfNotStartedError (instance, prop)}`);
            }
        }

        if (!/^[a-z0-9\-]+$/.test(name)) {
            throw new ConfigurationError(
                `"${name}" is not a valid service name: it must only contain lowercase letters, numbers and hyphens.`
            );
        }

        this.logger = createNamedLogger(name);
        return new Proxy(this,proxyHandler);
    }
    protected callsLog : string[] = [];

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
