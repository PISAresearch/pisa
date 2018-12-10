"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const express_http_context_1 = __importDefault(require("express-http-context"));
const logger_1 = __importDefault(require("./logger"));
const appointment_1 = require("./dataEntities/appointment");
const inspector_1 = require("./inspector");
const customExpressHttpContext_1 = require("./customExpressHttpContext");
const util_1 = require("util");
/**
 * Hosts a PISA service at the supplied host.
 */
class PisaService {
    constructor(hostname, port, inspector, watcher) {
        this.closed = false;
        const app = express_1.default();
        // accept json request bodies
        app.use(express_1.default.json());
        // use http context middleware to create a request id available on all requests
        app.use(express_http_context_1.default.middleware);
        app.use((req, res, next) => {
            customExpressHttpContext_1.setRequestId();
            next();
        });
        app.post("/appointment", this.appointment(inspector, watcher));
        const service = app.listen(port, hostname);
        logger_1.default.info(`PISA listening on: ${hostname}:${port}.`);
        this.server = service;
    }
    appointment(inspector, watcher) {
        return (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const appointmentRequest = appointment_1.parseAppointment(req.body);
                // inspect this appointment
                const appointment = yield inspector.inspect(appointmentRequest);
                // start watching it if it passed inspection
                yield watcher.watch(appointment);
                // PISA: only copy the relevant parts of the appointment - eg not the request id
                res.status(200);
                res.send(appointment);
            }
            catch (doh) {
                if (doh instanceof inspector_1.PublicInspectionError)
                    this.logAndSend(400, doh.message, doh, res);
                else if (doh instanceof appointment_1.PublicValidationError)
                    this.logAndSend(400, doh.message, doh, res);
                else if (doh instanceof Error)
                    this.logAndSend(500, "Internal server error.", doh, res);
                else {
                    logger_1.default.error("Error: 500. " + util_1.inspect(doh));
                    res.status(500);
                    res.send("Internal server error.");
                }
            }
        });
    }
    logAndSend(code, responseMessage, error, res) {
        logger_1.default.error(`HTTP Status: ${code}.`);
        logger_1.default.error(error.stack);
        res.status(code);
        res.send(responseMessage);
    }
    stop() {
        if (!this.closed) {
            this.server.close(logger_1.default.info(`PISA shutdown.`));
            this.closed = true;
        }
    }
}
exports.PisaService = PisaService;
