import { createLogger, Stream } from "bunyan";
import fs from "fs";
import path from "path";

const logDir = "logs";

// List of supported log levels; they are a subset of the npm log levels.
// IMPORTANT: keep the Enum in increasing order of priority (that is, increasing verbosity level)/
export enum LogLevel {
    Error = "error",
    Info = "info",
    Debug = "debug"
}

// Utility class to handle the log levels and their order. Lower `order` <==> higher priority.
export class LogLevelInfo {
    public static Error: LogLevelInfo = new LogLevelInfo(LogLevel.Error, 0);
    public static Info: LogLevelInfo = new LogLevelInfo(LogLevel.Info, 2);
    public static Debug: LogLevelInfo = new LogLevelInfo(LogLevel.Debug, 4);

    private constructor(public readonly logLevel: LogLevel, public readonly order: number) {}

    // Returns the appropriate singleton, or `null` if `logLevel` is not a valid log level
    static tryParse(logLevel: LogLevel): LogLevelInfo;
    static tryParse(logLevel: string): LogLevelInfo | null;
    public static tryParse(logLevel: LogLevel | string): LogLevelInfo | null {
        switch (logLevel) {
            case LogLevel.Error:
                return LogLevelInfo.Error;
            case LogLevel.Info:
                return LogLevelInfo.Info;
            case LogLevel.Debug:
                return LogLevelInfo.Debug;
            default:
                return null;
        }
    }

    /**
     * Returns the array with all the LogLevelInfo instances with order less than or equal to this instance.
     */
    public getLevelsBelow(): LogLevelInfo[] {
        const levels = Object.values(LogLevel) as LogLevel[];
        // prettier-ignore
        return levels
            .map(level => LogLevelInfo.tryParse(level))
            .filter(levelInfo => levelInfo.order <= this.order);
    }
}

// Default to log level "info", unless we are running tests, then "debug"
let currentLogLevelInfo: LogLevelInfo = process.env.NODE_ENV === "test" ? LogLevelInfo.Debug : LogLevelInfo.Info;

// create the log directory if it does not exist
if (!fs.existsSync("./" + logDir)) {
    fs.mkdirSync("./" + logDir);
}

// Default logger
const logger = createNamedLogger(null);
export default logger;

/**
 * Set the log level for new loggers and for the default logger.
 * NOTE: make sure to call this before any other logger is created.
 *
 * @throws ApplicationError if the provided `level` is not one of the allowed log levels.
 **/
export function setLogLevel(level: LogLevelInfo) {
    currentLogLevelInfo = level;
}

/**
 * Creates a named logger with name `name`. If `name` is given, the logs are saved in a file with the `${name}-` prefix.
 * Otherwise, there will be no prefix.
 * @param name
 */
export function createNamedLogger(name: string | null) {
    const prefix = name !== null ? name + "-" : "app";

    const streams: Stream[] = [];
    for (const levelInfo of currentLogLevelInfo.getLevelsBelow()) {
        streams.push({ path: path.join(logDir, `${prefix}${levelInfo.logLevel}.log`), level: levelInfo.logLevel });
    }

    // console log if we're not in production
    if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
        streams.push({
            stream: process.stdout,
            level: LogLevel.Info
        });
    }

    const newLogger = createLogger({
        name: prefix,
        streams
    });

    return newLogger;
}
