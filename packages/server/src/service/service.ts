import express, { Response } from "express";
import httpContext from "express-http-context";
import { Server } from "http";
import { ethers } from "ethers";
import { PublicInspectionError, PublicDataValidationError, ApplicationError } from "@pisa-research/errors";
import { Appointment } from "../dataEntities/appointment";
import { Watcher, AppointmentStore } from "../watcher";
import { PisaTower } from "./tower";
import { GasQueue, GasPriceEstimator, MultiResponder, MultiResponderComponent, ResponderStore, GasQueueItem, PisaTransactionIdentifier } from "../responder";
import { IArgConfig } from "./config";
import {
    BlockProcessorStore,
    BlockchainMachineService,
    CachedKeyValueStore,
    BlockProcessor,
    BlockCache,
    ReadOnlyBlockCache,
    blockFactory,
    Block,
    BlockItemStore,
    IBlockStub,
    ComponentAction
} from "@pisa-research/block";
import { LevelUp } from "levelup";
import encodingDown from "encoding-down";
import { StartStopService, Logger, DbObject, DbObjectSerialiser, defaultDeserialisers } from "@pisa-research/utils";
import path from "path";
import rateLimit from "express-rate-limit";
import uuid = require("uuid/v4");
import { BigNumber } from "ethers/utils";
import swaggerDoc from "./swagger-doc.json";
import favicon from "serve-favicon";
import cors from "cors";

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
    private readonly actionStore: CachedKeyValueStore<ComponentAction>;
    private readonly blockchainMachine: BlockchainMachineService<Block>;
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
     * @param logger The logger instance
     */
    constructor(
        config: IArgConfig,
        provider: ethers.providers.BaseProvider,
        responderWallet: ethers.Wallet,
        walletNonce: number,
        chainId: number,
        receiptWallet: ethers.Wallet,
        db: LevelUp<encodingDown<string, DbObject>>,
        logger: Logger
    ) {
        super("service", logger);
        const app = express();
        this.applyMiddlewares(app, config);

        const serialiser = new DbObjectSerialiser({
            ...defaultDeserialisers,
            [Appointment.TYPE]: Appointment.deserialise,
            [GasQueueItem.TYPE]: GasQueueItem.deserialise,
            [GasQueue.TYPE]: GasQueue.deserialise,
            [PisaTransactionIdentifier.TYPE]: PisaTransactionIdentifier.deserialise
        });

        // block cache and processor
        const cacheLimit = config.maximumReorgLimit == undefined ? 200 : config.maximumReorgLimit;
        this.blockItemStore = new BlockItemStore<Block>(db, serialiser, logger);
        const blockCache = new BlockCache<Block>(cacheLimit, this.blockItemStore);
        const blockProcessorStore = new BlockProcessorStore(db);
        this.blockProcessor = new BlockProcessor<Block>(provider, blockFactory, blockCache, this.blockItemStore, blockProcessorStore, logger);

        // stores
        this.appointmentStore = new AppointmentStore(db, logger);
        const seedQueue = new GasQueue([], walletNonce, 12, 13);
        this.responderStore = new ResponderStore(db, responderWallet.address, seedQueue, logger);

        // managers
        const multiResponder = new MultiResponder(
            responderWallet,
            new GasPriceEstimator(responderWallet.provider, this.blockProcessor.blockCache),
            chainId,
            this.responderStore,
            responderWallet.address,
            new BigNumber("500000000000000000"),
            config.pisaContractAddress,
            logger
        );

        // components and machine
        const watcher = new Watcher(
            multiResponder,
            this.blockProcessor.blockCache,
            this.appointmentStore,
            logger,
            config.watcherResponseConfirmations === undefined ? 5 : config.watcherResponseConfirmations,
            config.maximumReorgLimit === undefined ? 100 : config.maximumReorgLimit
        );
        const responder = new MultiResponderComponent(
            multiResponder,
            this.blockProcessor.blockCache,
            logger,
            config.maximumReorgLimit == undefined ? 100 : config.maximumReorgLimit
        );

        this.actionStore = new CachedKeyValueStore<ComponentAction>(db, serialiser, "blockchain-machine", logger);
        this.blockchainMachine = new BlockchainMachineService<Block>(this.blockProcessor, this.actionStore, this.blockItemStore, logger, [watcher, responder]);

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
        // also host the docs at the root
        app.get("/", (req, res) => {
            res.setHeader("Content-Type", "text/html");
            res.send(this.redocHtml());
        });
        app.get(this.JSON_SCHEMA_ROUTE, (req, res) => {
            res.sendFile(path.join(__dirname, "dataEntities/appointmentRequestSchema.json"));
        });
        app.get(this.APPOINTMENT_CUSTOMER_GET_ROUTE, this.getAppointmentsByCustomer(this.appointmentStore, blockCache));

        // set up 404
        app.all("*", function(req, res) {
            res.status(404).json({
                message: `Route ${req.url} not found, only available routes are POST at /appointment and GET at /docs.html`
            });
        });

        const service = app.listen(config.hostPort, config.hostName);
        // never log private parts of the config
        const { receiptKey, responderKey, ...rest } = config;
        this.logger.info({ code: "p_serv_settings", ...rest, responderAddress: responderWallet.address, receiptSignerAddress: receiptWallet.address }, "PISA config settings."); // prettier-ignore
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
            if (error) this.logger.error({ code: "p_serv_shutdownerr", err: error }, "Error shutting down server.");
            this.logger.info({ code: "p_serv_shutdown" }, `Shutdown.`);
        });
    }

    private applyMiddlewares(app: express.Express, config: IArgConfig) {
        // accept json request bodies
        app.use(express.json());

        // allow cors on all routes
        app.use(cors());
        app.options("*", cors());

        // use http context middleware to create a request id available on all requests
        app.use(httpContext.middleware);
        app.use(favicon(path.join(__dirname, "favicon.ico")));
        app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
            (req as any).log = this.logger.child({ requestId: uuid() });
            next();
        });
        // set up base error handler
        app.use((err: Error, req: requestAndLog, res: express.Response, next: express.NextFunction) => {
            this.logger.error({ code: "p_serv_basehandler", err, req, res, requestBody: req.body }, "Base handler");
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
                    req.log.info({ code: "p_serv_docsreq", logEntry }, "Docs request.");
                } else if (res.statusCode == 200) {
                    req.log.info({ code: "p_serv_succresp", logEntry }, "Success response.");
                } else if (res.statusCode >= 400) {
                    req.log.error({ code: "p_serv_errresp", logEntry }, "Error response.");
                } else req.log.error({ code: "p_serv_othresp", logEntry }, "Other response.");
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

    private handlerWrapper<T>(handlerFunction: (req: requestAndLog) => Promise<T>) {
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
                    req.log.error({ code: "p_serv_error500" }, doh);
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
    private getAppointmentsByCustomer(appointmentStore: AppointmentStore, blockCache: ReadOnlyBlockCache<IBlockStub>) {
        return this.handlerWrapper(async (req: requestAndLog) => {
            const customerAddress = PisaParameterParser.customerAddress(req);
            const authBlock = PisaHeaderParser.authBlock(req, blockCache);
            const authSig = PisaHeaderParser.authSig(req);

            // authenticate
            const authenticator = new Authenticator(req.log);
            authenticator.authenticate(authBlock, authSig, customerAddress);

            const appointments = [...(appointmentStore.appointmentsByCustomerAddress.get(customerAddress) || [])];

            // return the appointments
            return JSON.stringify(appointments.map(app => Appointment.toIAppointmentRequest(app)));
        });
    }

    private logAndSend(code: number, responseMessage: string, error: Error, res: Response, req: requestAndLog) {
        req.log.error({ code: `p_serv_error${code}` , err: error}, "Response error");
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

class Authenticator {
    constructor(private readonly logger: Logger) {}

    public authenticate(blockNumber: number, signature: string, customerAddress: string) {
        let recoveredAddress;
        try {
            recoveredAddress = ethers.utils.verifyMessage(ethers.utils.arrayify("0x" + blockNumber.toString(16)), signature);
        } catch (doh) {
            this.logger.error({ code: "p_auth_fail", err: doh }, "Error authenticating.");
            throw new PublicDataValidationError("Invalid x-auth-sig header.");
        }
        if (recoveredAddress !== customerAddress) throw new PublicDataValidationError("Signing key does not match customer address.");
    }
}

class PisaParameterParser {
    public static customerAddress(req: express.Request) {
        // customer address
        const customerAddress: string = req.params.customerAddress;
        if (!customerAddress) throw new PublicDataValidationError("Missing customerAddress parameter in url.");
        return customerAddress;
    }
}

class PisaHeaderParser {
    private static HEADER_AUTH_BLOCK = "x-auth-block";
    private static HEADER_AUTH_SIG = "x-auth-sig";

    public static authBlock(req: requestAndLog, blockCache: ReadOnlyBlockCache<IBlockStub>) {
        // auth block
        const authBlockString = req.headers[PisaHeaderParser.HEADER_AUTH_BLOCK];
        if (authBlockString == undefined) throw new PublicDataValidationError("Missing header x-auth-block must contain recent block number.");

        let authBlock;
        try {
            authBlock = Number.parseInt(authBlockString as string);
        } catch (doh) {
            req.log.error({ code: "p_headerparse_err", err: doh }, "Error paring the header.");
            throw new PublicDataValidationError("Header x-auth-block is not an integer.");
        }
        if (authBlock > blockCache.head.number + 5) throw new PublicDataValidationError(`Header x-auth-block too high. Must be within 5 blocks of current block ${blockCache.head.number}.`); //prettier-ignore
        if (authBlock < blockCache.head.number - 5) throw new PublicDataValidationError(`Header x-auth-block too low. Must be within 5 blocks of current block ${blockCache.head.number}.`); //prettier-ignore

        return authBlock;
    }

    public static authSig(req: requestAndLog) {
        const sig = req.headers[PisaHeaderParser.HEADER_AUTH_SIG];
        if (sig == undefined) throw new PublicDataValidationError("Missing header x-auth-sig must contain authentication signature.");
        if (Array.isArray(sig)) throw new PublicDataValidationError("Invalid x-auth-sig. Only one header of this name may be supplied.");
        return sig;
    }
}
