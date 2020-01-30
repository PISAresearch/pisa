import yargs from "yargs";
import pino, { stdSerializers } from "pino";
import { ArgumentError } from "@pisa-research/errors";

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

// standard logger that components can create children from.
export const logger = pino({
    serializers: {
        err: ArgumentErrorSerialiser,
        res: stdSerializers.res,
        req: stdSerializers.req
    },
    name: args.name,
    enabled
});
if(!args.help && args.name === "not-set") logger.warn("Instance name not set. Set this via the --name command line argument.")