import { createLogger, format, transports } from "winston";
import { getRequestId } from "./customExpressHttpContext";
import fs from "fs";
const logDir = "logs";
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

export function createNamedLogger(name: string | null) {
    const prefix = name !== null ? name + "-" : "";
    const newLogger = createLogger({
        level: "info",
        format: combinedFormats,
        transports: [
            new transports.File({ dirname: logDir, filename: `${prefix}error.log`, level: "error" }),
            new transports.File({ dirname: logDir, filename: `${prefix}info.log`, level: "info" }),
            new transports.File({ dirname: logDir, filename: `${prefix}debug.log`, level: "debug" })
        ]
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

// Default logger
const logger = createNamedLogger(null);
export default logger;
