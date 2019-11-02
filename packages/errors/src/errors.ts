/**
 * Base class for errors thrown by the application.
 * If a `nestedError` is given, it customizes the stacktrace in order to also
 * show the full stack trace of the originating error.
 */
export class ApplicationError extends Error {
    /**
     *
     * @param message The error message.
     * @param nestedError Optionally, the `Error` instance of the originating error.
     * @param name The name of the error shown in the stack trace; the `name` property is set to this value.
     *             Subclasses of `ApplicationError` should always pass their name.
     *             If not provided, the default value `"ApplicationError"` will be used.
     */
    constructor(message: string);
    constructor(message: string, nestedError: Error);
    constructor(message: string, nestedError: Error | undefined, name: string);
    constructor(message: string, nestedError?: Error, name: string = "ApplicationError") {
        super(message);

        this.name = name;

        if (nestedError) {
            // As the stack property is not standard (and browsers might differ in behavior compared to Node's implementation),
            // we guard for its existence and keep the behavior simple.
            if (nestedError.stack != undefined && this.stack != undefined) {
                // Concatenate the stack traces
                this.stack += "\nCaused by: " + nestedError.stack;
            }
        }
    }
}

/**
 * Thrown when code that is not supposed to be reached was actually reached. It can be used to make sure that a series of if-then-else or
 * cases in a switch statement over an enum or union types is exhaustive, in a type-safe way.
 * Errors of this kind represent a bug.
 */
export class UnreachableCaseError extends ApplicationError {
    constructor(val: never, message?: string) {
        const msg = `Unreachable code: ${val}`;
        super(message ? `${message} ${msg}` : msg, undefined, "UnreachableCaseError");
    }
}

/**
 * Thrown when startup configuration is incorrect.
 */
export class ConfigurationError extends ApplicationError {
    constructor(message: string) {
        super(message, undefined, "ConfigurationError");
    }
}

/**
 * Thrown when an event times out.
 **/
export class TimeoutError extends ApplicationError {
    constructor(message: string) {
        super(message, undefined, "TimeoutError");
    }
}

/**
 * Thrown when an attempt to fetch a block fails.
 */
export class BlockFetchingError extends ApplicationError {
    constructor(message: string);
    constructor(message: string, nestedError: Error);
    constructor(message: string, nestedError?: Error) {
        super(message, nestedError, "BlockFetchingError");
    }
}

/**
 * Thrown when data does not match a specified format
 * Error messages must be safe to expose publicly
 */
export class PublicDataValidationError extends ApplicationError {
    constructor(message: string) {
        super(message, undefined, "PublicDataValidationError");
    }
}

/**
 * Thrown when an appointment fails inspection
 * Error messages must be safe to expose publicly
 */
export class PublicInspectionError extends ApplicationError {
    constructor(message: string, nestedError?: Error) {
        super(message, nestedError, "PublicInspectionError");
    }
}

/**
 * Thrown when incorrect arguments are supploed to a function
 */
export class ArgumentError extends ApplicationError {
    public readonly args: any[];

    constructor(message: string);
    constructor(message: string, ...args: any[]);
    constructor(message: string, ...args: any[]) {
        super(message, undefined, "ArgumentError");
        this.args = args;
    }
}

/**
 * Thrown when an inconsistency in a queue is observed.
 */
export class QueueConsistencyError extends ApplicationError {
    constructor(message: string) {
        super(message, undefined, "QueueConsistencyError");
    }
}
