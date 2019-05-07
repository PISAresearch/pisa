import express, { Response } from "express";
import httpContext from "express-http-context";
import rateLimit from "express-rate-limit";
import { Server } from "http";
import { inspect } from "util";
import { ethers } from "ethers";
import logger from "./logger";
import { PublicInspectionError, PublicDataValidationError, ApplicationError, StartStopService } from "./dataEntities";
import { Raiden, Kitsune } from "./integrations";
import { Watcher, AppointmentStore } from "./watcher";
import { PisaTower } from "./tower";
import { setRequestId } from "./customExpressHttpContext";
import { EthereumResponderManager } from "./responder";
import { AppointmentStoreGarbageCollector } from "./watcher/garbageCollector";
import { AppointmentSubscriber } from "./watcher/appointmentSubscriber";
import { IApiEndpointConfig } from "./dataEntities/config";
import { ReorgDetector } from "./blockMonitor/reorg";
import { ReorgHeightListenerStore } from "./blockMonitor";
import levelup, { LevelUp } from "levelup";
import leveldown from "leveldown";
import encodingDown from "encoding-down";

/**
 * Hosts a PISA service at the endpoint.
 */
export class PisaService extends StartStopService {
    private readonly server: Server;
    private readonly garbageCollector: AppointmentStoreGarbageCollector;
    private readonly reorgDetector: ReorgDetector;
    private readonly watcher: Watcher;
    private readonly db: LevelUp<encodingDown<string, any>>;

    /**
     *
     * @param hostname The location to host the pisa service. eg. 0.0.0.0
     * @param port The port on which to host the pisa service
     * @param provider A connection to ethereum
     * @param wallet A signing authority for submitting transactions
     * @param delayedProvider A connection to ethereum that is delayed by a number of confirmations
     * @param config Optional configuration of the Pisa endpoint
     */
    constructor(
        hostname: string,
        port: number,
        provider: ethers.providers.BaseProvider,
        wallet: ethers.Wallet,
        delayedProvider: ethers.providers.BaseProvider,
        config?: IApiEndpointConfig
    ) {
        super("PISA");
        const app = express();

        this.applyMiddlewares(app, config);

        // start reorg detector
        this.reorgDetector = new ReorgDetector(delayedProvider, 200, new ReorgHeightListenerStore());

        // intialise the db
        this.db = levelup(encodingDown(leveldown("test-location"), { valueEncoding: "json" }));

        // dependencies
        const store = new AppointmentStore(this.db);
        const ethereumResponderManager = new EthereumResponderManager(wallet);
        const appointmentSubscriber = new AppointmentSubscriber(delayedProvider);
        this.watcher = new Watcher(
            delayedProvider,
            ethereumResponderManager,
            this.reorgDetector,
            appointmentSubscriber,
            store
        );

        // gc
        this.garbageCollector = new AppointmentStoreGarbageCollector(provider, 10, store, appointmentSubscriber);

        // tower
        const tower = new PisaTower(provider, this.watcher, [Raiden, Kitsune]);

        app.post("/appointment", this.appointment(tower));

        const service = app.listen(port, hostname);
        logger.info(`PISA listening on: ${hostname}:${port}.`);
        this.server = service;
    }

    async startInternal() {
        await this.reorgDetector.start();
        await this.watcher.start();
        await this.garbageCollector.start();
    }

    async stopInternal() {
        await this.garbageCollector.stop();
        await this.reorgDetector.stop();
        await this.watcher.stop();
        await this.db.close();
        this.server.close(error => {
            if (error) logger.error(error.stack!);
            logger.info(`PISA shutdown.`);
        });
    }

    private applyMiddlewares(app: express.Express, config?: IApiEndpointConfig) {
        // accept json request bodies
        app.use(express.json());
        // use http context middleware to create a request id available on all requests
        app.use(httpContext.middleware);
        app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
            setRequestId();
            next();
        });

        // rate limits
        if (config && config.rateGlobal) {
            app.use(
                new rateLimit({
                    keyGenerator: () => "global", // use the same key for all users
                    statusCode: 503, // = Too Many Requests (RFC 7231)
                    message: "Server request limit reached. Please try again later.",
                    ...config.rateGlobal
                })
            );
            logger.info(
                `PISA api global rate limit: ${config.rateGlobal.max} requests every: ${config.rateGlobal.windowMs /
                    1000} seconds.`
            );
        } else {
            logger.warn(`PISA api global rate limit: NOT SET.`);
        }

        if (config && config.ratePerUser) {
            app.use(
                new rateLimit({
                    keyGenerator: req => req.ip, // limit per IP
                    statusCode: 429, // = Too Many Requests (RFC 6585)
                    message: "Too many requests. Please try again later.",
                    ...config.ratePerUser
                })
            );
            logger.info(
                `PISA api per-user rate limit: ${config.ratePerUser.max} requests every: ${config.ratePerUser.windowMs /
                    1000} seconds.`
            );
        } else {
            logger.warn(`PISA api per-user rate limit: NOT SET.`);
        }
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
        logger.error(error.stack!);
        res.status(code);
        res.send(responseMessage);
    }
}
