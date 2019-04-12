/**
 * Thrown when startup configuration is incorrect.
 */
export class ConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ConfigurationError";
    }
}

/**
 * Thrown when data does not match a specified format
 * Error messages must be safe to expose publicly
 */
export class PublicDataValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PublicDataValidationError";
    }
}

/**
 * Thrown when an appointment fails inspection
 * Error messages must be safe to expose publicly
 */
export class PublicInspectionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PublicInspectionError";
    }
}

/**
 * Thrown by the application when it encounters an unrecoverable error. Errors of this kind represent a bug.
 */
export class ApplicationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ApplicationError";
    }
}
