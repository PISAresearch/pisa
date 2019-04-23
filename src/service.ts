import express, { Response } from "express";
import httpContext from "express-http-context";
import logger from "./logger";
import { PublicInspectionError, PublicDataValidationError, ApplicationError } from "./dataEntities";
import { Raiden, Kitsune } from "./integrations";
import { Watcher, MemoryAppointmentStore } from "./watcher";
import { PisaTower } from "./tower";
// PISA: this isn working properly, it seems that watchers are sharing the last set value...
import { setRequestId } from "./customExpressHttpContext";
import { Server } from "http";
import { inspect } from "util";
import { ethers } from "ethers";
import { EthereumResponderManager } from "./responder";
import { EventObserver } from "./watcher/eventObserver";
import { AppointmentStoreGarbageCollector } from "./watcher/garbageCollector";
import { AppointmentSubscriber } from "./watcher/appointmentSubscriber";

/**
 * Hosts a PISA service at the endpoint.
 */
export class PisaService {
    private readonly server: Server;
    private readonly garbageCollector: AppointmentStoreGarbageCollector;

    /**
     *
     * @param hostname The location to host the pisa service. eg. 0.0.0.0
     * @param port The port on which to host the pisa service
     * @param provider A connection to ethereum
     * @param wallet A signing authority for submitting transactions
     * @param delayedProvider A connection to ethereum that is delayed by a number of confirmations
     */
    constructor(
        hostname: string,
        port: number,
        provider: ethers.providers.Provider,
        wallet: ethers.Wallet,
        delayedProvider: ethers.providers.Provider
    ) {
        const app = express();
        // accept json request bodies
        app.use(express.json());
        // use http context middleware to create a request id available on all requests
        app.use(httpContext.middleware);
        app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
            setRequestId();
            next();
        });

        // dependencies
        const store = new MemoryAppointmentStore();
        const ethereumResponderManager = new EthereumResponderManager(wallet);
        const eventObserver = new EventObserver(ethereumResponderManager, store);
        const appointmentSubscriber = new AppointmentSubscriber(delayedProvider);
        const watcher = new Watcher(eventObserver, appointmentSubscriber, store);
        const tower = new PisaTower(provider, watcher, [Raiden, Kitsune]);

        // start gc
        this.garbageCollector = new AppointmentStoreGarbageCollector(provider, 10, store, appointmentSubscriber);
        this.garbageCollector.start();

        app.post("/appointment", this.appointment(tower));

        const service = app.listen(port, hostname);
        logger.info(`PISA listening on: ${hostname}:${port}.`);
        this.server = service;
    }

    // PISA: it would be much nicer to log with appointment data in this handler
    // PISA: perhaps we can attach to the logger? should we be passing a logger to the tower itself?

    private appointment(tower: PisaTower) {
        return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
            try {
                const appointment = await tower.addAppointment(req.body);

                // return the appointment
                res.status(200);
                res.send(appointment);
            } catch (doh) {
                if (doh instanceof PublicInspectionError) this.logAndSend(400, doh.message, doh, res);
                else if (doh instanceof PublicDataValidationError) this.logAndSend(400, doh.message, doh, res);
                else if (doh instanceof ApplicationError) this.logAndSend(500, doh.message, doh, res);
                else if (doh instanceof Error) this.logAndSend(500, "Internal server error.", doh, res);
                else {
                    logger.error("Error: 500. \n" + inspect(doh));
                    res.status(500);
                    res.send("Internal server error.");
                }
            }
        };
    }

    private logAndSend(code: number, responseMessage: string, error: Error, res: Response) {
        logger.error(`HTTP Status: ${code}.`);
        logger.error(error.stack);
        res.status(code);
        res.send(responseMessage);
    }

    private closed = false;
    public stop() {
        if (!this.closed) {
            this.garbageCollector.stop();
            this.server.close(logger.info(`PISA shutdown.`));
            this.closed = true;
        }
    }
}
