import pino, { stdSerializers } from "pino";
import { ArgumentError } from "@pisa-research/errors";
import express from "express";

// allow logging to be disabled during tests
const enabled = process.env.NODE_ENV !== "test";

// a custom serialiser for arguments error
function ArgumentErrorSerialiser(err: Error) {
    if (err instanceof ArgumentError) {
        return {
            args: err.args,
            ...stdSerializers.err(err)
        };
    } else return stdSerializers.err(err);
}

export interface BaseLogObject {
    code: string;
    err?: Error;
    res?: express.Response;
    req?: express.Request;
}

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export class Logger {
    public static readonly LEVEL_DEBUG = pino.levels.values.debug;
    public static readonly LEVEL_INFO = pino.levels.values.info;
    public static readonly LEVEL_WARN = pino.levels.values.warn;
    public static readonly LEVEL_ERROR = pino.levels.values.error;
    public static readonly LEVEL_SILENT = pino.levels.values.silent;

    /**
     * Returns the corresponding numerical value of the log level corresponding to `levelName`.
     * @param levelName
     * @throws ArgumentError if an invalid log level name is provided.
     */
    public static getLevel(levelName: string) {
        switch (levelName) {
            case "debug":
                return Logger.LEVEL_DEBUG;
            case "info":
                return Logger.LEVEL_INFO;
            case "warn":
                return Logger.LEVEL_WARN;
            case "error":
                return Logger.LEVEL_ERROR;
            case "silent":
                return Logger.LEVEL_SILENT;
            default:
                throw new ArgumentError(`"${levelName}" is not a valid log level name.`);
        }
    }

    private readonly children: Logger[] = [];

    private constructor(private readonly pino: pino.Logger) {}

    public static getLogger(name = "not-set", level: LogLevel = enabled ? "debug" : "silent") {
        return new Logger(
            pino({
                serializers: {
                    err: ArgumentErrorSerialiser,
                    res: stdSerializers.res,
                    req: stdSerializers.req
                },
                name,
                enabled
            })
        );
    }

    public debug<T extends BaseLogObject>(obj: T, message: string) {
        this.pino.debug(obj, message);
    }
    public info<T extends BaseLogObject>(obj: T, message: string) {
        this.pino.info(obj, message);
    }
    public warn<T extends BaseLogObject>(obj: T, message: string) {
        this.pino.warn(obj, message);
    }
    public error<T extends BaseLogObject>(obj: T, message: string) {
        this.pino.error(obj, message);
    }
    /**
     * Makes a child logger. See pino's documentation for the specifications of the `bindings` parameter.
     * @param bindings
     */
    public child(bindings: { level?: string; serializers?: { [key: string]: pino.SerializerFn }; [key: string]: any }) {
        const result = new Logger(this.pino.child(bindings));
        this.children.push(result);
        return result;
    }

    // We wrap the level, as we only allow a subset of pino's levels
    private mLevel: LogLevel;
    public get level() {
        return this.mLevel;
    }

    /**
     * Set the level of this logger and (recursively) all the children of this Logger.
     */
    public set level(newLevel: LogLevel) {
        this.pino.level = newLevel;
        for (const child of this.children) {
            child.level = newLevel;
        }
    }
}
