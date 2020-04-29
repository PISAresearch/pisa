import yargs from "yargs";
import pino, { stdSerializers } from "pino";
import { ArgumentError } from "@pisa-research/errors";
import express from "express";

// an instance name can be provided via command line args
const parseCommandLine = (argv: string[]) => {
    return (yargs
        .option("name", {
            description: "Instance name",
            string: true,
            default: "not-set"
        })
        .option("help", {
            description: "help",
            boolean: true,
            default: false
        })
        .help(false)
        .parse(argv) as {
        name: string; help: boolean
    });
};
const args = parseCommandLine(process.argv);

// allow logging to be disable during tests
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

export class Logger {
    private constructor(private readonly pino: pino.Logger) {}

    public static getLogger() {
        return new Logger(
            pino({
                serializers: {
                    err: ArgumentErrorSerialiser,
                    res: stdSerializers.res,
                    req: stdSerializers.req
                },
                name: args.name,
                enabled
            })
        );
    }

    public info<T extends BaseLogObject>(obj: T, message: string) {
        this.pino.info(obj, message);
    }
    public error<T extends BaseLogObject>(obj: T, message: string) {
        this.pino.error(obj, message);
    }
    public warn<T extends BaseLogObject>(obj: T, message: string) {
        this.pino.warn(obj, message);
    }
    /**
     * Makes a child logger. See pino's documentation for the specifications of the `bindings` parameter.
     * @param bindings
     */
    public child(bindings: { level?: string; serializers?: { [key: string]: pino.SerializerFn }; [key: string]: any }) {
        return new Logger(this.pino.child(bindings));
    }
}

// standard logger that components can create children from.
export const logger = Logger.getLogger();

if (!args.help && args.name === "not-set") logger.warn({ code: "a_logger_notset" }, "Instance name not set. Set this via the --name command line argument.");
