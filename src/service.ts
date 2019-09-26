import express, { Response } from "express";
import httpContext from "express-http-context";
import { Server } from "http";
import { ethers } from "ethers";
import { PublicInspectionError, PublicDataValidationError, ApplicationError, StartStopService, Appointment } from "./dataEntities";
import { Watcher, AppointmentStore } from "./watcher";
import { PisaTower } from "./tower";
import { GasPriceEstimator, MultiResponder, MultiResponderComponent, ResponderStore } from "./responder";
import { IArgConfig } from "./dataEntities/config";
import { BlockProcessor, BlockCache } from "./blockMonitor";
import { LevelUp } from "levelup";
import encodingDown from "encoding-down";
import { blockFactory } from "./blockMonitor";
import { Block, BlockItemStore } from "./dataEntities/block";
import { BlockchainMachine } from "./blockMonitor/blockchainMachine";
import { ActionStore } from "./blockMonitor/actionStore";
import { Logger } from "./logger";
import path from "path";
import { GasQueue } from "./responder/gasQueue";
import rateLimit from "express-rate-limit";
import uuid = require("uuid/v4");
import { BigNumber } from "ethers/utils";
import swaggerDoc from "./public/swagger-doc.json";
import favicon from "serve-favicon";
import { BlockProcessorStore } from "./blockMonitor/blockProcessor";

/**
 * Request object supplemented with a log
 */
type requestAndLog = express.Request & { log: Logger };

/**
 * Hosts a PISA service at the endpoint.
 */
export class PisaService extends StartStopService {
    private readonly server: Server;
    private readonly blockItemStore: BlockItemStore<Block>;
    private readonly blockProcessor: BlockProcessor<Block>;
    private readonly responderStore: ResponderStore;
    private readonly appointmentStore: AppointmentStore;
    private readonly actionStore: ActionStore;
    private readonly blockchainMachine: BlockchainMachine<Block>;
    private readonly JSON_SCHEMA_ROUTE = "/schemas/appointmentRequest.json";
    private readonly API_DOCS_JSON_ROUTE = "/api-docs.json";
    private readonly API_DOCS_HTML_ROUTE = "/docs.html";
    private readonly APPOINTMENT_ROUTE = "/appointment";
    private readonly APPOINTMENT_CUSTOMER_GET_ROUTE = "/appointment/customer/:customerAddress";

    /**
     *
     * @param config PISA service configuration info
     * @param port The port on which to host the pisa service
     * @param provider A connection to ethereum
     * @param responderWallet A signing authority for submitting transactions
     * @param receiptWallet A signing authority for receipts returned from Pisa
     * @param db The instance of the database
     */
    constructor(
        config: IArgConfig,
        provider: ethers.providers.BaseProvider,
        responderWallet: ethers.Wallet,
        walletNonce: number,
        chainId: number,
        receiptWallet: ethers.Wallet,
        db: LevelUp<encodingDown<string, any>>
    ) {
        super("pisa");
        const app = express();
        this.applyMiddlewares(app, config);

        // block cache and processor
        const cacheLimit = config.maximumReorgLimit == undefined ? 200 : config.maximumReorgLimit;
        this.blockItemStore = new BlockItemStore<Block>(db);
        const blockCache = new BlockCache<Block>(cacheLimit, this.blockItemStore);
        const blockProcessorStore = new BlockProcessorStore(db);
        this.blockProcessor = new BlockProcessor<Block>(provider, blockFactory, blockCache, this.blockItemStore, blockProcessorStore);

        // stores
        this.appointmentStore = new AppointmentStore(db);
        const seedQueue = new GasQueue([], walletNonce, 12, 13);
        this.responderStore = new ResponderStore(db, responderWallet.address, seedQueue);

        // managers
        const multiResponder = new MultiResponder(
            responderWallet,
            new GasPriceEstimator(responderWallet.provider, this.blockProcessor.blockCache),
            chainId,
            this.responderStore,
            responderWallet.address,
            new BigNumber("500000000000000000"),
            config.pisaContractAddress
        );

        // components and machine
        const watcher = new Watcher(
            multiResponder,
            this.blockProcessor.blockCache,
            this.appointmentStore,
            config.watcherResponseConfirmations === undefined ? 5 : config.watcherResponseConfirmations,
            config.maximumReorgLimit === undefined ? 100 : config.maximumReorgLimit
        );
        const responder = new MultiResponderComponent(
            multiResponder,
            this.blockProcessor.blockCache,
            config.maximumReorgLimit == undefined ? 100 : config.maximumReorgLimit
        );

        this.actionStore = new ActionStore(db);

        this.blockchainMachine = new BlockchainMachine<Block>(this.blockProcessor, this.actionStore, this.blockItemStore);
        this.blockchainMachine.addComponent(watcher);
        this.blockchainMachine.addComponent(responder);

        // tower
        const tower = new PisaTower(this.appointmentStore, receiptWallet, multiResponder, blockCache, config.pisaContractAddress);

        app.post(this.APPOINTMENT_ROUTE, this.appointment(tower));

        // api docs
        app.get(this.API_DOCS_JSON_ROUTE, (req, res) => {
            res.setHeader("Content-Type", "application/json");
            res.send(swaggerDoc);
        });
        app.get(this.API_DOCS_HTML_ROUTE, (req, res) => {
            res.setHeader("Content-Type", "text/html");
            res.send(this.redocHtml());
        });
        app.get(this.JSON_SCHEMA_ROUTE, (req, res) => {
            res.sendFile(path.join(__dirname, "dataEntities/appointmentRequestSchema.json"));
        });
        app.get(this.APPOINTMENT_CUSTOMER_GET_ROUTE, this.getAppointmentsByCustomer(this.appointmentStore));

        // set up 404
        app.all("*", function(req, res) {
            res.status(404).json({
                message: `Route ${req.url} not found, only availale routes are POST at /appointment and GET at /docs.html`
            });
        });

        const service = app.listen(config.hostPort, config.hostName);
        // never log private parts of the config
        const { receiptKey, responderKey, ...rest } = config;
        this.logger.info({ ...rest, responderAddress: responderWallet.address, receiptSignerAddress: receiptWallet.address }, "PISA config settings."); // prettier-ignore
        this.server = service;
    }

    protected async startInternal() {
        await this.blockItemStore.start();
        await this.actionStore.start();
        await this.blockchainMachine.start();
        await this.blockProcessor.start();
        await this.appointmentStore.start();
        await this.responderStore.start();
    }

    protected async stopInternal() {
        await this.responderStore.stop();
        await this.appointmentStore.stop();
        await this.blockProcessor.stop();
        await this.blockchainMachine.stop();
        await this.actionStore.stop();
        await this.blockItemStore.stop();

        this.server.close(error => {
            if (error) this.logger.error(error);
            this.logger.info(`Shutdown.`);
        });
    }

    private applyMiddlewares(app: express.Express, config: IArgConfig) {
        // accept json request bodies
        app.use(express.json());
        // use http context middleware to create a request id available on all requests
        app.use(httpContext.middleware);
        app.use(favicon(path.join(__dirname, "public", "favicon.ico")));
        app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
            (req as any).log = this.logger.child({ requestId: uuid() });
            next();
        });
        // set up base error handler
        app.use((err: Error, req: requestAndLog, res: express.Response, next: express.NextFunction) => {
            this.logger.error({ err, req, res, requestBody: req.body }, "Base handler");
            if ((err as any).statusCode === 400) {
                res.status(400);
                res.send({ message: "Bad request" });
            } else if ((err as any).statusCode) {
                try {
                    Number.parseInt((err as any).statusCode);
                    res.status((err as any).statusCode);
                    res.send({});
                } catch (doh) {
                    res.status(500);
                    res.send({ message: "Internal server error" });
                }
            } else {
                res.status(500);
                res.send({ message: "Internal server error" });
            }
        });
        app.use((req: requestAndLog, res: express.Response, next: express.NextFunction) => {
            //log the duration of every request, and the body in case of error
            const startNano = process.hrtime.bigint();
            res.on("finish", () => {
                const endNano = process.hrtime.bigint();
                const microDuration = Number.parseInt((endNano - startNano).toString()) / 1000;
                // right now we log the request body
                // this probably isn't sutainable in the long term, but it should help us
                // get a good idea of usage in the short term
                const logEntry = { req: req, res: res, duration: microDuration, requestBody: req.body };

                if (
                    // is this a docs request
                    [this.JSON_SCHEMA_ROUTE, this.API_DOCS_JSON_ROUTE, this.API_DOCS_HTML_ROUTE].map(a => a.toLowerCase()).indexOf(req.url.toLowerCase()) !==
                        -1 &&
                    res.statusCode < 400
                ) {
                    req.log.info(logEntry, "Docs request.");
                } else if (res.statusCode == 200) {
                    req.log.info(logEntry, "Success response.");
                } else if (res.statusCode >= 400) {
                    req.log.error(logEntry, "Error response.");
                } else req.log.error(logEntry, "Other response.");
            });
            next();
        });

        // rate limits
        if (config.rateLimitGlobalMax && config.rateLimitGlobalWindowMs) {
            app.use(
                new rateLimit({
                    keyGenerator: () => "global", // use the same key for all users
                    statusCode: 503, // = Too Many Requests (RFC 7231)
                    message: config.rateLimitGlobalMessage || "Server request limit reached. Please try again later.",
                    windowMs: config.rateLimitGlobalWindowMs,
                    max: config.rateLimitGlobalMax
                })
            );
        }

        if (config.rateLimitUserMax && config.rateLimitUserWindowMs) {
            app.use(
                new rateLimit({
                    keyGenerator: req => req.ip, // limit per IP
                    statusCode: 429, // = Too Many Requests (RFC 6585)
                    message: config.rateLimitUserMessage || "Too many requests. Please try again later.",
                    windowMs: config.rateLimitUserWindowMs,
                    max: config.rateLimitUserMax
                })
            );
        }
    }

    private handlerWrapper(handlerFunction: (req: requestAndLog) => Promise<any>) {
        return async (req: requestAndLog, res: express.Response, next: express.NextFunction) => {
            if (!this.started) {
                res.status(503);
                res.send({ message: "Service initialising, please try again later." });
                return;
            }

            try {
                const result = await handlerFunction(req);
                res.status(200);
                res.send(result);
            } catch (doh) {
                if (doh instanceof PublicInspectionError) this.logAndSend(400, doh.message, doh, res, req);
                else if (doh instanceof PublicDataValidationError) this.logAndSend(400, doh.message, doh, res, req);
                else if (doh instanceof ApplicationError) this.logAndSend(500, "Internal server error", doh, res, req);
                else if (doh instanceof Error) this.logAndSend(500, "Internal server error.", doh, res, req);
                else {
                    req.log.error(doh);
                    res.status(500);
                    res.send({ message: "Internal server error." });
                }
            }
        };
    }

    /**
     * Add an appointment to the tower
     * @param tower
     */
    private appointment(tower: PisaTower) {
        return this.handlerWrapper(async (req: requestAndLog) => {
            const signedAppointment = await tower.addAppointment(req.body, req.log);
            return signedAppointment.serialise();
        });
    }

    /**
     * Get all the appointments for a given customer from the tower
     * @param appointmentStore
     */
    private getAppointmentsByCustomer(appointmentStore: AppointmentStore) {
        return this.handlerWrapper(async (req: requestAndLog) => {
            let customerAddress: string = req.params.customerAddress;
            if (!customerAddress) throw new PublicDataValidationError("Missing customerAddress parameter in url.");

            const appointments = [...(appointmentStore.appointmentsByCustomerAddress.get(customerAddress) || [])];

            // return the appointments
            return JSON.stringify(appointments.map(app => Appointment.toIAppointmentRequest(app)));
        });
    }

    private logAndSend(code: number, responseMessage: string, error: Error, res: Response, req: requestAndLog) {
        req.log.error(error);
        res.status(code);
        res.send({ message: responseMessage });
    }

    private redocHtml() {
        return `<!DOCTYPE html>
            <html>
            <head>
                <title>PISA</title>
                <!-- needed for adaptive design -->
                <meta charset="utf-8"/>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">

                <!--
                ReDoc doesn't change outer page styles
                -->
                <style>
                body {
                    margin: 0;
                    padding: 0;
                }
                </style>
            </head>
            <body>
                <!-- we provide is specification here -->
                <redoc spec-url='.${this.API_DOCS_JSON_ROUTE}' expand-responses="all" disable-search="true"></redoc>
                <script src="https://cdn.jsdelivr.net/npm/redoc@next/bundles/redoc.standalone.js"> </script>
            </body>
        </html>`;
    }
}
