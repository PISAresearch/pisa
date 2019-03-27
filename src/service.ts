import express, { Response } from "express";
import httpContext from "express-http-context";
import logger from "./logger";
import { PublicValidationError, AppointmentRequest } from "./dataEntities/appointment";
import { PublicInspectionError, IInspector, MultiInspector } from "./inspector/inspector";
import { KitsuneInspector } from "./inspector/kitsune"
import { RaidenInspector } from "./inspector/raiden"
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

    //PISA: arg documentation
    constructor(hostname: string, port: number, provider: ethers.providers.Provider, wallet: ethers.Wallet) {
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
        const watcher = new Watcher(provider, wallet, responder);
        const kitsuneInspector = new KitsuneInspector(10, provider);
        // PISA: currently set to 4 for demo purposes - this should be a commandline/config arg
        const raidenInspector = new RaidenInspector(4, provider);
        const multiInspector = new MultiInspector([kitsuneInspector, raidenInspector]);

        app.post("/appointment", this.appointment(multiInspector, watcher));

        const service = app.listen(port, hostname);
        logger.info(`PISA listening on: ${hostname}:${port}.`);
        this.server = service;
    }

    private appointment(inspector: IInspector, watcher: Watcher) {
        return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
            try {
                const appointmentRequest = AppointmentRequest.parse(req.body);
                // inspect this appointment
                const appointment = await inspector.inspect(appointmentRequest);

                // start watching it if it passed inspection
                await watcher.watch(appointment);

                // return the appointment
                res.status(200);
                res.send(appointment);
            } catch (doh) {
                if (doh instanceof PublicInspectionError) this.logAndSend(400, doh.message, doh, res);
                else if (doh instanceof PublicValidationError) this.logAndSend(400, doh.message, doh, res);
                else if (doh instanceof Error) this.logAndSend(500, "Internal server error.", doh, res);
                else {
                    logger.error("Error: 500. " + inspect(doh));
                    res.status(500);
                    res.send("Internal server error.");
                }
            }
        };
    }

    private logAndSend(code: number, responseMessage: string, error: Error, res: Response) {
        if (code === 500) console.log(error);
        logger.error(`HTTP Status: ${code}.`);
        logger.error(error.stack);
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
