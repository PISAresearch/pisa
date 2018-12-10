"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const winston_1 = require("winston");
const customExpressHttpContext_1 = require("./customExpressHttpContext");
const myFormat = winston_1.format.printf(info => {
    // get the current request id
    // PISA: is this performant? run a test
    const requestId = customExpressHttpContext_1.getRequestId();
    const requestString = requestId ? `[${requestId}] ` : "";
    return `${info.timestamp} ${requestString}${info.level}: ${info.message}`;
});
const combinedFormats = winston_1.format.combine(winston_1.format.timestamp(), myFormat);
const logger = winston_1.createLogger({
    level: "info",
    format: combinedFormats,
    transports: [
        new winston_1.transports.File({ filename: "error.log", level: "error" }),
        new winston_1.transports.File({ filename: "info.log", level: "info" }),
        new winston_1.transports.File({ filename: "debug.log", level: "debug" })
    ]
});
// console log if we're not in production
if (process.env.NODE_ENV !== "production") {
    logger.add(new winston_1.transports.Console({
        format: combinedFormats
    }));
}
exports.default = logger;
