import { createLogger, format, transports } from "winston";
import { getRequestId } from "./customExpressHttpContext";
import fs from "fs";
const logDir = "logs";

// For now, we only support three log levels
export type LogLevel = "error" | "info" | "debug";
export const supportedLogLevels: LogLevel[] = ["error", "info", "debug"];
type NpmLogLevel = "error" | "warn" | "info" | "verbose" | "debug" | "silly";

// Default to log level "info", unless we are running tests, then "debug"
let logLevel: LogLevel = process.env.NODE_ENV === "test" ? "debug" : "info";

// Returns the numerical npm log level
function getLevelNumber(level: NpmLogLevel): number {
    return {
        error: 0,
        warn: 1,
        info: 2,
        verbose: 3,
        debug: 4,
        silly: 5
    }[level];
}

// create the log directory if it doesnt exist
if (!fs.existsSync("./" + logDir)) {
    fs.mkdirSync("./" + logDir);
}

const myFormat = format.printf(info => {
    // get the current request id
    const requestId = getRequestId();
    const requestString = requestId ? `[${requestId}] ` : "";
    return `${info.timestamp} ${requestString}${info.level}: ${info.message}`;
});

const combinedFormats = format.combine(format.timestamp(), myFormat);

// Default logger
const logger = createNamedLogger(null);
export default logger;

/**
 * Set the log level for new loggers and for the default logger.
 * NOTE: make sure to call this before any other logger is created.
 **/
export function setLogLevel(level: LogLevel) {
    logLevel = level; // set log level for future logs
    logger.level = level; // set log level for the default logger as well
}

/**
 * Creates a named logger with name `name`. If `name` is given, the logs are saved in file with the `${name}-` prefix.
 * Otherwise, there will be no prefix.
 * @param name
 */
export function createNamedLogger(name: string | null) {
    const prefix = name !== null ? name + "-" : "";

    const levelNumber = getLevelNumber(logLevel);

    const selectedTransports: transports.FileTransportInstance[] = [];
    for (const level of supportedLogLevels) {
        if (getLevelNumber(level) <= levelNumber) {
            selectedTransports.push(new transports.File({ dirname: logDir, filename: `${prefix}${level}.log`, level }));
        }
    }

    const newLogger = createLogger({
        format: combinedFormats,
        transports: selectedTransports
    });

    // console log if we're not in production
    if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
        newLogger.add(
            new transports.Console({
                format: combinedFormats
            })
        );
    }

    return newLogger;
}
