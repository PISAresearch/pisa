export class ConfigurationError extends Error {}

/**
 * Thrown when data does not match a specified format
 * Error messages must be safe to expose publicly
 */
export class PublicDataValidationError extends Error {}

/**
 * Thrown when an appointment fails inspection
 * Error messages must be safe to expose publicly
 */
export class PublicInspectionError extends Error {}
