import express, { Response } from "express";
import httpContext from "express-http-context";
import logger from "./logger";
import { Appointment, PublicInspectionError, PublicDataValidationError } from "./dataEntities";
import { Inspector } from "./inspector";
import { Raiden, Kitsune, IChannelConfig } from "./integrations";
import { Watcher } from "./watcher";
// PISA: this isn working properly, it seems that watchers are sharing the last set value...
import { setRequestId } from "./customExpressHttpContext";
import { Server } from "http";
import { inspect } from "util";
import { ethers } from "ethers";
import { Responder } from "./responder";

/**
 * A PISA tower, configured to watch for specified appointment types
 */
class PisaTower {
    constructor(
        public readonly provider: ethers.providers.Provider,
        public readonly watcher: Watcher,
        channelConfigs: IChannelConfig<Appointment, Inspector<Appointment>>[]
    ) {
        channelConfigs.forEach(c => (this.configs[c.channelType] = c));
    }

    configs: {
        [type: number]: IChannelConfig<Appointment, Inspector<Appointment>>;
    } = {};

    /**
     * Checks that the object is well formed, that it meets the conditions necessary for watching and assigns it to be watched.
     * @param obj
     */
    async addAppointment(obj: any) {
        if (!obj) throw new PublicDataValidationError("No content specified.");

        // look for a type argument
        const type = obj["type"];
        const config = this.configs[type];
        if (!config) throw new PublicDataValidationError(`Unknown appointment type ${type}.`);

        // parse the appointment
        const appointment = config.appointment(obj);

        const inspector = config.inspector(10, this.provider);
        // inspect this appointment, an error is thrown if inspection is failed
        await inspector.inspectAndPass(appointment);

        // start watching it if it passed inspection
        await this.watcher.addAppointment(appointment);

        return appointment;
    }
}

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
        const tower = new PisaTower(jsonRpcProvider, watcher, [Raiden, Kitsune]);

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
            this.server.close(logger.info(`PISA shutdown.`));
            this.closed = true;
        }
    }
}
