/**
 * Thrown by the application when it encounters an unrecoverable error. Errors of this kind represent a bug.
 */
export class ApplicationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ApplicationError";
    }
}

/**
 * Thrown when code that is not supposed to be reached was actually reached. It can be used to make sure that a series of if-then-else or
 * cases in a switch statement over an enum or union types is exhaustive, in a type-safe way.
 * Errors of this kind represent a bug.
 */
export class UnreachableCaseError extends Error {
    constructor(val: never) {
        super(`Unreachable code: ${val}`);
        this.name = "UnreachableCaseError";
    }
}

/**
 * Thrown when startup configuration is incorrect.
 */
export class ConfigurationError extends ApplicationError {
    constructor(message: string) {
        super(message);
        this.name = "ConfigurationError";
    }
}

/**
 * Thrown when an event times out.
 **/
export class TimeoutError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TimeoutError";
    }
}

/**
 * Thrown when data does not match a specified format
 * Error messages must be safe to expose publicly
 */
export class PublicDataValidationError extends ApplicationError {
    constructor(message: string) {
        super(message);
        this.name = "PublicDataValidationError";
    }
}

/**
 * Thrown when an appointment fails inspection
 * Error messages must be safe to expose publicly
 */
export class PublicInspectionError extends ApplicationError {
    constructor(message: string) {
        super(message);
        this.name = "PublicInspectionError";
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
        super(message);
        this.args = args;
        this.name = "ArgumentError";
    }
}

/**
 * Thrown after some number of blocks has been mined while waiting for something to happen.
 */
export class BlockThresholdReachedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BlockThresholdReachedError";
    }
}
/**
 * Thrown when no block has been received by the provider for too long.
 * This might signal either a failure in the provider, or abnormal blockchain conditions.
 */
export class BlockTimeoutError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BlockTimeoutError";
    }
}

/**
 * Thrown when there was a re-org.
 */
export class ReorgError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ReorgError";
    }
}

/**
 * Thrown when an inconsistency in a queue is observed.
 */
export class QueueConsistencyError extends ApplicationError {
    constructor(message: string) {
        super(message);
        this.name = "QueueConsistencyError";
    }
}
