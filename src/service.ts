import express, { Response } from "express";
import httpContext from "express-http-context";
import { Server } from "http";
import { ethers } from "ethers";
import { PublicInspectionError, PublicDataValidationError, ApplicationError, StartStopService } from "./dataEntities";
import { Watcher, AppointmentStore } from "./watcher";
import { PisaTower, HotEthereumAppointmentSigner } from "./tower";
import { GasPriceEstimator, MultiResponder, MultiResponderComponent, ResponderStore } from "./responder";
import { IArgConfig } from "./dataEntities/config";
import { BlockProcessor, BlockCache } from "./blockMonitor";
import { LevelUp } from "levelup";
import encodingDown from "encoding-down";
import { blockFactory } from "./blockMonitor";
import { Block } from "./dataEntities/block";
import { BlockchainMachine } from "./blockMonitor/blockchainMachine";
import swaggerJsDoc from "swagger-jsdoc";
import { Logger } from "./logger";
import path from "path";
import { GasQueue } from "./responder/gasQueue";
import rateLimit from "express-rate-limit";
import uuid = require("uuid/v4");

/**
 * Request object supplemented with a log
 */
type requestAndLog = express.Request & { log: Logger };

/**
 * Hosts a PISA service at the endpoint.
 */
export class PisaService extends StartStopService {
    private readonly server: Server;
    private readonly blockProcessor: BlockProcessor<Block>;
    private readonly responderStore: ResponderStore;
    private readonly appointmentStore: AppointmentStore;
    private readonly blockchainMachine: BlockchainMachine<Block>;

    /**
     *
     * @param config PISA service configuration info
     * @param port The port on which to host the pisa service
     * @param provider A connection to ethereum
     * @param wallet A signing authority for submitting transactions
     * @param receiptSigner A signing authority for receipts returned from Pisa
     * @param db The instance of the database
     */
    constructor(
        config: IArgConfig,
        provider: ethers.providers.BaseProvider,
        wallet: ethers.Wallet,
        walletNonce: number,
        chainId: number,
        receiptSigner: ethers.Signer,
        db: LevelUp<encodingDown<string, any>>
    ) {
        super("pisa");
        const app = express();
        this.applyMiddlewares(app, config);

        // block cache and processor
        const cacheLimit = config.maximumReorgLimit === undefined ? 200 : config.maximumReorgLimit;
        const blockCache = new BlockCache<Block>(cacheLimit);
        this.blockProcessor = new BlockProcessor<Block>(provider, blockFactory, blockCache);

        // stores
        this.appointmentStore = new AppointmentStore(db);
        const seedQueue = new GasQueue([], walletNonce, 12, 13);
        this.responderStore = new ResponderStore(db, wallet.address, seedQueue);

        // managers
        const multiResponder = new MultiResponder(
            wallet,
            new GasPriceEstimator(wallet.provider, this.blockProcessor.blockCache),
            chainId,
            this.responderStore,
            wallet.address,
            500000000000000000
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
        this.blockchainMachine = new BlockchainMachine<Block>(this.blockProcessor);
        this.blockchainMachine.addComponent(watcher);
        this.blockchainMachine.addComponent(responder);

        // if a key to sign receipts was provided, create an EthereumAppointmentSigner
        const appointmentSigner = new HotEthereumAppointmentSigner(receiptSigner);

        // tower
        const tower = new PisaTower(provider, this.appointmentStore, appointmentSigner, multiResponder);

        app.post("/appointment", this.appointment(tower));

        // api docs
        const hostAndPort = `${config.hostPort}:${config.hostPort}`;
        const docs = swaggerJsDoc(this.createSwaggerDocs(hostAndPort));
        app.get("/api-docs.json", (req, res) => {
            res.setHeader("Content-Type", "application/json");
            res.send(docs);
        });
        app.get("/docs", (req, res) => {
            res.sendFile(path.join(__dirname, "../docs/redoc.html"));
        });
        app.get("/schemas/appointmentRequest.json", (req, res) => {
            res.sendFile(path.join(__dirname, "dataEntities/appointmentRequestSchema.json"));
        });

        const service = app.listen(config.hostPort, config.hostName);
        this.logger.info(config);
        this.server = service;
    }

    private createSwaggerDocs(hostAndPort: string): swaggerJsDoc.Options {
        const options = {
            definition: {
                //openapi: "3.0.0", // Specification (optional, defaults to swagger: '2.0')
                info: {
                    title: "PISA",
                    version: "0.1.0"
                },
                host: hostAndPort,
                basePath: "/"
            },
            // Path to the API docs
            apis: ["./src/service.ts", "./src/service.js", "./build/src/service.js"]
        };

        return options;
    }

    protected async startInternal() {
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
        app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
            (req as any).log = this.logger.child({ requestId: uuid() });
            next();
        });
        app.use((req: requestAndLog, res: express.Response, next: express.NextFunction) => {
            //log the duration of every request, and the body in case of error
            const startNano = process.hrtime.bigint();
            res.on("finish", () => {
                const endNano = process.hrtime.bigint();
                const microDuration =   Number.parseInt((endNano - startNano).toString()) / 1000
                const logEntry = { req: req, res: res, duration: microDuration };

                if (res.statusCode !== 200) {
                    req.log.error({ ...logEntry, requestBody: req.body }, "Error response.");
                }
                // right now we log the request body as well even on a success response
                // this probably isn't sutainable in the long term, but it should help us
                // get a good idea of usage in the short term
                else req.log.info({ ...logEntry, requestBody: req.body }, "Success response.");
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

    /**
     * @swagger
     *
     * /appointment:
     *   post:
     *     description: Request an appointmnt
     *     produces:
     *       - application/json
     *     parameters:
     *       - name: appointment request
     *         description: Appointment request
     *         in: body
     *         required: true
     *         type: object
     *         schema:
     *           $ref: 'schemas/appointmentRequest.json'
     *     responses:
     *       200:
     */
    private appointment(tower: PisaTower) {
        return async (req: requestAndLog, res: express.Response, next: express.NextFunction) => {
            if (!this.started) {
                res.status(503);
                res.send({ message: "Service initialising, please try again later." });
                return;
            }

            try {
                const signedAppointment = await tower.addAppointment(req.body, req.log);

                // return the appointment
                res.status(200);

                // with signature
                res.send(signedAppointment.serialise());
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

    private logAndSend(code: number, responseMessage: string, error: Error, res: Response, req: requestAndLog) {
        req.log.error(error);
        res.status(code);
        res.send({ message: responseMessage });
    }
}
