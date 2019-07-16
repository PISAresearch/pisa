import express, { Response } from "express";
import httpContext from "express-http-context";
import rateLimit from "express-rate-limit";
import { Server } from "http";
import { inspect } from "util";
import { ethers } from "ethers";
import {
    PublicInspectionError,
    PublicDataValidationError,
    ApplicationError,
    StartStopService,
    ChannelType,
    IEthereumAppointment
} from "./dataEntities";
import { Raiden, Kitsune } from "./integrations";
import { Watcher, AppointmentStore } from "./watcher";
import { PisaTower, HotEthereumAppointmentSigner } from "./tower";
import { setRequestId } from "./customExpressHttpContext";
import { GasPriceEstimator, MultiResponder, MultiResponderComponent } from "./responder";
import { AppointmentStoreGarbageCollector } from "./watcher/garbageCollector";
import { IArgConfig } from "./dataEntities/config";
import { BlockProcessor, BlockCache } from "./blockMonitor";
import { LevelUp } from "levelup";
import encodingDown from "encoding-down";
import { blockFactory } from "./blockMonitor";
import { Block } from "./dataEntities/block";
import { BlockchainMachine } from "./blockMonitor/blockchainMachine";

/**
 * Hosts a PISA service at the endpoint.
 */
export class PisaService extends StartStopService {
    private readonly server: Server;
    private readonly garbageCollector: AppointmentStoreGarbageCollector;
    private readonly blockProcessor: BlockProcessor<Block>;
    private readonly multiResponder: MultiResponder;
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
     * @param watcherResponseConfirmations The number of confirmations the watcher should wait before starting a response
     * @param watcherRemovalConfirmations The number of confirmations the watcher should wait before removing an appointment
     */
    constructor(
        config: IArgConfig,
        provider: ethers.providers.BaseProvider,
        wallet: ethers.Wallet,
        receiptSigner: ethers.Signer,
        db: LevelUp<encodingDown<string, any>>,
        watcherResponseConfirmations: number,
        watcherRemovalConfirmations: number
    ) {
        super("pisa");
        const app = express();

        this.applyMiddlewares(app, config);

        // choose configs
        const configs = [Raiden, Kitsune];

        // start reorg detector and block monitor
        const blockCache = new BlockCache<Block>(200);
        this.blockProcessor = new BlockProcessor<Block>(provider, blockFactory, blockCache);

        // dependencies
        this.appointmentStore = new AppointmentStore(
            db,
            new Map(configs.map<[ChannelType, (obj: any) => IEthereumAppointment]>(c => [c.channelType, c.appointment]))
        );

        this.multiResponder = new MultiResponder(
            wallet,
            new GasPriceEstimator(wallet.provider, this.blockProcessor.blockCache)
        );

        const watcher = new Watcher(
            this.multiResponder,
            this.blockProcessor.blockCache,
            this.appointmentStore,
            watcherResponseConfirmations,
            watcherRemovalConfirmations
        );

        this.blockchainMachine = new BlockchainMachine<Block>(this.blockProcessor);
        this.blockchainMachine.addComponent(watcher);
        this.blockchainMachine.addComponent(
            new MultiResponderComponent(
                this.multiResponder,
                this.blockProcessor.blockCache,
                this.blockProcessor.blockCache.maxDepth - 1
            )
        );

        // gc
        this.garbageCollector = new AppointmentStoreGarbageCollector(provider, 10, this.appointmentStore);

        // if a key to sign receipts was provided, create an EthereumAppointmentSigner
        const appointmentSigner = new HotEthereumAppointmentSigner(receiptSigner);

        // tower
        const tower = new PisaTower(provider, this.appointmentStore, appointmentSigner, configs);

        app.post("/appointment", this.appointment(tower));

        const service = app.listen(config.hostPort, config.hostName);
        this.logger.info(`Listening on: ${config.hostName}:${config.hostPort}.`);
        this.server = service;
    }

    protected async startInternal() {
        await this.blockchainMachine.start();
        await this.blockProcessor.start();
        await this.garbageCollector.start();
        await this.appointmentStore.start();
        await this.multiResponder.start();
    }

    protected async stopInternal() {
        await this.multiResponder.stop();
        await this.appointmentStore.stop();
        await this.garbageCollector.stop();
        await this.blockProcessor.stop();
        await this.blockchainMachine.stop();

        this.server.close(error => {
            if (error) this.logger.error(error.stack!);
            this.logger.info(`Shutdown.`);
        });
    }

    private applyMiddlewares(app: express.Express, config: IArgConfig) {
        // accept json request bodies
        app.use(express.json());
        // use http context middleware to create a request id available on all requests
        app.use(httpContext.middleware);
        app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
            setRequestId();
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
            this.logger.info(
                `Api global rate limit: ${config.rateLimitGlobalMax} requests every: ${config.rateLimitGlobalWindowMs /
                    1000} seconds.`
            );
        } else {
            this.logger.warn(`Api global rate limit: NOT SET.`);
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
            this.logger.info(
                `Api per-user rate limit: ${config.rateLimitUserMax} requests every: ${config.rateLimitUserWindowMs /
                    1000} seconds.`
            );
        } else {
            this.logger.warn(`Api per-user rate limit: NOT SET.`);
        }
    }

    // PISA: it would be much nicer to log with appointment data in this handler
    // PISA: perhaps we can attach to the logger? should we be passing a logger to the tower itself?

    private appointment(tower: PisaTower) {
        return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
            if (!this.started) {
                this.logger.error("Service initialising. Could not serve request: \n" + inspect(req.body));
                res.status(503);
                res.send("Service initialising, please try again later.");
                return;
            }

            try {
                const signedAppointment = await tower.addAppointment(req.body);

                // return the appointment
                res.status(200);

                // with signature
                res.send(signedAppointment.serialise());
            } catch (doh) {
                if (doh instanceof PublicInspectionError) this.logAndSend(400, doh.message, doh, res);
                else if (doh instanceof PublicDataValidationError) this.logAndSend(400, doh.message, doh, res);
                else if (doh instanceof ApplicationError) this.logAndSend(500, doh.message, doh, res);
                else if (doh instanceof Error) this.logAndSend(500, "Internal server error.", doh, res);
                else {
                    this.logger.error("Error: 500. \n" + inspect(doh));
                    res.status(500);
                    res.send("Internal server error.");
                }
            }
        };
    }

    private logAndSend(code: number, responseMessage: string, error: Error, res: Response) {
        this.logger.error(`HTTP Status: ${code}.`);
        this.logger.error(error.stack!);
        res.status(code);
        res.send(responseMessage);
    }
}
