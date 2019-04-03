import express, { Response } from "express";
import httpContext from "express-http-context";
import logger from "./logger";
import { Appointment, PublicInspectionError, PublicDataValidationError } from "./dataEntities";
import { Inspector, MultiInspector } from "./inspector/inspector";
import { KitsuneInspector } from "./inspector/kitsune";
import { RaidenInspector } from "./inspector/raiden";
import { Watcher } from "./watcher";
// PISA: this isn working properly, it seems that watchers are sharing the last set value...
import { setRequestId } from "./customExpressHttpContext";
import { Server } from "http";
import { inspect } from "util";
import { ethers } from "ethers";
import { Responder } from "./responder";

/**
 * Hosts a PISA service at the endpoint.
 */
export class PisaService {
    private readonly server: Server;

    /**
     *
     * @param hostname The location to host the pisa service. eg. 0.0.0.0
     * @param port The port on which to host the pisa service
     * @param jsonRpcProvider A connection to ethereum
     * @param wallet A signing authority for submitting transactions
     */
    constructor(hostname: string, port: number, jsonRpcProvider: ethers.providers.Provider, wallet: ethers.Wallet) {
        const app = express();
        // accept json request bodies
        app.use(express.json());
        // use http context middleware to create a request id available on all requests
        app.use(httpContext.middleware);
        app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
            setRequestId();
            next();
        });

        const responder = new Responder(10);
        const watcher = new Watcher(jsonRpcProvider, wallet, responder);
        const kitsuneInspector = new KitsuneInspector(10, jsonRpcProvider);
        // PISA: currently set to 4 for demo purposes - this should be a commandline/config arg
        const raidenInspector = new RaidenInspector(4, jsonRpcProvider);
        const multiInspector = new MultiInspector([kitsuneInspector, raidenInspector]);

        app.post("/appointment", this.appointment(multiInspector, watcher));

        const service = app.listen(port, hostname);
        logger.info(`PISA listening on: ${hostname}:${port}.`);
        this.server = service;
    }

    // PISA: check all the logger calls for inspect()

    private appointment(inspector: Inspector, watcher: Watcher) {
        return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
            let appointment: Appointment;
            try {
                appointment = Appointment.parse(req.body);
                // inspect this appointment, an error is thrown if inspection is failed
                await inspector.inspectAndPass(appointment);

                // start watching it if it passed inspection
                await watcher.addAppointment(appointment);

                // return the appointment
                res.status(200);
                res.send(appointment);
            } catch (doh) {
                if (doh instanceof PublicInspectionError) this.logAndSend(400, doh.message, doh, res, appointment);
                else if (doh instanceof PublicDataValidationError)
                    this.logAndSend(400, doh.message, doh, res, appointment);
                else if (doh instanceof Error) this.logAndSend(500, "Internal server error.", doh, res, appointment);
                else {
                    logger.error(
                        appointment
                            ? appointment.formatLogEvent("Error: 500. \n" + inspect(doh))
                            : "Error: 500. \n" + inspect(doh)
                    );
                    res.status(500);
                    res.send("Internal server error.");
                }
            }
        };
    }

    private logAndSend(code: number, responseMessage: string, error: Error, res: Response, appointment: Appointment) {
        logger.error(appointment ? appointment.formatLogEvent(`HTTP Status: ${code}.`) : `HTTP Status: ${code}.`);
        logger.error(appointment ? appointment.formatLogEvent(error.stack) : error.stack);
        res.status(code);
        res.send(responseMessage);
    }

    private closed = false;
    public stop() {
        if (!this.closed) {
            this.server.close(logger.info(`PISA shutdown.`));
            this.closed = true;
        }
    }
}
