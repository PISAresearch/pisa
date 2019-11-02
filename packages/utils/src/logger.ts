import { createLogger, Stream, stdSerializers } from "bunyan";
import fs from "fs";
import path from "path";
import { ArgumentError } from "@pisa-research/errors";
import Bunyan from "bunyan";
export { Bunyan as Logger };

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

// create the log directory if it does not exist
if (!fs.existsSync("./" + logDir)) {
    fs.mkdirSync("./" + logDir);
}

let initialisedLogLevelInfo = LogLevelInfo.Info;
let initialisedInstanceName = "not-set";

// Default logger
export const logger: Bunyan = createNamedLogger("main", initialisedLogLevelInfo);

// Default to log level "info", unless we are running tests, then "debug"


/**
 * Set the initialisation settings for new loggers and for the default logger.
 * NOTE: make sure to call this before any other logger is created.
 **/
export function initialise(level: LogLevelInfo, instanceName: string) {
    initialisedLogLevelInfo = level;
    if (instanceName) initialisedInstanceName = instanceName;
}

function ArgumentErrorSerialiser(err: Error) {
    if (err instanceof ArgumentError) {
        return {
            args: err.args,
            ...stdSerializers.err(err)
        };
    } else return stdSerializers.err(err);
}

/**
 * Creates a named logger with name `name`. If `name` is given, the logs are saved in a file with the `${name}-` prefix.
 * Otherwise, there will be no prefix.
 * @param component
 */
export function createNamedLogger(component: string, logLevel: LogLevelInfo = initialisedLogLevelInfo) {
    const prefix = component + "-";

    const streams: Stream[] = [];
    for (const levelInfo of logLevel.getLevelsBelow()) {
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
        name: "pisa-watchtower",
        streams,
        serializers: {
            err: ArgumentErrorSerialiser,
            res: stdSerializers.res,
            req: stdSerializers.req
        }
    })
        .child({ "instance-name": initialisedInstanceName })
        .child({ component: component });

    return newLogger;
}
