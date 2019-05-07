import { EventEmitter } from "events";
import { ethers } from "ethers";
import { wait, plural, CancellablePromise } from "./utils";
import { waitForConfirmations, rejectAfterBlocks, BlockThresholdReachedError, rejectIfAnyBlockTimesOut } from "./utils/ethers";
import { IEthereumAppointment, IEthereumResponseData } from "./dataEntities/appointment";
import logger from "./logger";
import { ApplicationError, ArgumentError } from "./dataEntities";

/**
 * Responsible for storing the state and managing the flow of a single response.
 */
// TODO: This class and ResponseState are not currently used in any meaningful way.
//       The plan is to use them for accounting, make sure this is the case.
export abstract class ResponseFlow {
    private static nextId: number = 0;

    readonly id: number;
    readonly creationTimestamp: number;

    public state = ResponseState.Started;

    constructor(readonly appointmentId: string) {
        this.id = ResponseFlow.nextId++;
        this.creationTimestamp = Date.now();
    }
}

/**
 * This class stores the state of a response on the Ethereum blockchain.
 */
export class EthereumResponseFlow extends ResponseFlow {
    public txHash: string | null = null; // if a transaction has been sent, this is its hash
    constructor(public appointmentId: string, public readonly ethereumResponseData: IEthereumResponseData) {
        super(appointmentId);
    }
}

/**
 * Represents the current state of a Response
 */
export enum ResponseState {
    Ready,        // initial status
    Started,      // flow started
    ResponseSent, // responded, but waiting for enough confirmations
    Success,      // responded with enough confirmations
    Failed        // response flow failed
}

/**
 * Represents the possible events emitted by a Responder.
 */
export enum ResponderEvent {
    ResponseSent = "responseSent",
    ResponseConfirmed = "responseConfirmed",
    AttemptFailed = "attemptFailed",
    ResponseFailed = "responseFailed"
}

/**
 * Responsible for responding to observed events.
 * The responder is solely responsible for ensuring that a transaction gets to the blockchain.
 */
export abstract class Responder extends EventEmitter {
    /**
     * Creates a new Response object, initiating the flow of submitting state to the blockchain.
     */
    constructor() {
        super();
    }

    // Commodity function to emit events asynchronously
    protected asyncEmit(...args: any[]): Promise<boolean> {
        return new Promise(resolve => resolve(this.emit.apply(this, args)))
    }
}

/**
 * A generic abstract responder for the Ethereum blockchain.
 * It has exclusive control of a wallet, that is, no two instances should share the same wallet.
 * It implements the submitStateFunction, but no strategy.
 */
export abstract class EthereumResponder extends Responder {
    // TODO-93: the correct gas limit should be provided based on the appointment/integration.
    //          200000 is enough for Kitsune and Raiden (see https://github.com/raiden-network/raiden-contracts/blob/master/raiden_contracts/data/gas.json).
    private static GAS_LIMIT = 200000;

    // implementations should query the provider (or a service) to figure out the appropriate gas price
    protected gasPrice = new ethers.utils.BigNumber(21000000000);

    protected provider: ethers.providers.Provider;

    constructor(public readonly signer: ethers.Signer) {
        super();

        if (!signer.provider) throw new ArgumentError("The given signer is not connected to a provider");

        this.provider = signer.provider;
    }

    /**
     * Creates the transaction request to be sent to handle the response in `resposeData`.
     *
     * @param responseData the response data used to create the transaction
     * @param nonce The nonce to be used.
     */
    protected prepareTransactionRequest(responseData: IEthereumResponseData, nonce: number): ethers.providers.TransactionRequest {
        // form the interface so that we can serialise the args and the function name
        const abiInterface = new ethers.utils.Interface(responseData.contractAbi);
        const data = abiInterface.functions[responseData.functionName].encode(responseData.functionArgs);
        // now create a transaction, specifying possible oher variables
        return {
            to: responseData.contractAddress,
            gasLimit: EthereumResponder.GAS_LIMIT,
            nonce: nonce,
            gasPrice: this.gasPrice,
            data: data
        };
    }

    /**
    * @param appointmentId The id of the Appointment this object is responding to.
    * @param response The IEthereumResponse containing what needs to be submitted.
    */
    public abstract startResponse(appointmentId: string, responseData: IEthereumResponseData): void;
}


/* CONCRETE RESPONDER IMPLEMENTATIONS */

/**
 * A gas policy implements the strategy for the choice of the gas price for subsequent attempts at submitting a transaction.
 */
export interface IGasPolicy {
    getInitialPrice(): Promise<ethers.utils.BigNumber>
    getIncreasedGasPrice(previousPrice: ethers.utils.BigNumber): ethers.utils.BigNumber
}


/**
 * A simple gas choice strategy that queries the provider for an initial estimate of the gas price, and then it doubles it
 * at each subsequent attempt.
 */
export class DoublingGasPolicy implements IGasPolicy {
    constructor(private readonly provider: ethers.providers.Provider) { }

    getInitialPrice(): Promise<ethers.utils.BigNumber> {
        return this.provider.getGasPrice();
    }

    getIncreasedGasPrice(previousPrice: ethers.utils.BigNumber): ethers.utils.BigNumber {
        return previousPrice.mul(2);
    }
}

/**
 * A simple custom Error class to signal that the speified number of blocks has been mined.
 */
export class StuckTransactionError extends Error {
   constructor(message: string) {
       super(message);
       this.name = "StuckTransactionError";
   }
}


/**
 * This class encapsulates the logic of trying to send a transaction and make sure it is mined with enough confirmations.
 */
export class EthereumTransactionMiner {
    private provider: ethers.providers.Provider;

    /**
     * @param signer The Signer to use to send the transaction.
     * @param confirmationsRequired The number of confirmations required.
     * @param blocksThresholdForStuckTransaction The number of new blocks without the transaction is mined before considering
     *                                           the transaction "stuck".
     * @param newBlockTimeout The number of milliseconds after which the provider is considered non-responsive.
     * @param pollInterval The number of milliseconds between checks for timeouts on receiving blocks.
     */
    constructor(
        public readonly signer: ethers.Signer,
        public readonly confirmationsRequired: number,
        public readonly blocksThresholdForStuckTransaction: number,
        public readonly newBlockTimeout: number,
        private readonly pollInterval: number
    ) {
        if (!signer.provider) throw new ArgumentError("The given signer is not connected to a provider");

        this.provider = signer.provider;
    }

    /**
     * This method sends the transaction, and resolves to the transaction hash.
     * If an error is thrown, see ethers.js documentation for `JsonRpcSigner.sendTransaction`.
     * @param transactionRequest The TransactionRequest to be sent.
     */
    public async sendTransaction(transactionRequest: ethers.providers.TransactionRequest): Promise<string> {
        const txResponse = await this.signer.sendTransaction(transactionRequest);
        return txResponse.hash!;
    }

    /**
     * Resolves after the transaction receives the first confirmation.
     * Rejects with `NoNewBlockError` the provider does not receive a new block for `newBlockTimeout` milliseconds.
     * Rejects with `BlockThresholdReachedError` if the transaction is still unconfirmed
     * after `blocksThresholdForStuckTransaction` blocks are mined.
     *
     * @param txHash The transaction hash, returned by `sendTransaction`.
     * @param timeLastBlockReceived Optional; if known, the time when the last block was received by the provider.
     *                              The provider will be considered unresponsive after `newBlockTimeout` from `timeLastBlockReceived`.
     */
    public async waitForFirstConfirmation(txHash: string, timeLastBlockReceived: number) {
        const lastBlockNumberSeen = await this.provider.getBlockNumber();

        // Promise that waits for the first confirmation
        const firstConfirmationPromise = waitForConfirmations(this.provider, txHash, 1, false);

        // Promise that rejects after WAIT_BLOCKS_BEFORE_RETRYING blocks are mined
        const firstConfirmationTimeoutPromise = rejectAfterBlocks(
            this.provider, lastBlockNumberSeen, this.blocksThresholdForStuckTransaction
        );

        // ...but stop with error if no new blocks come for too long
        const noNewBlockPromise = rejectIfAnyBlockTimesOut(
            this.provider,
            timeLastBlockReceived,
            this.newBlockTimeout,
            this.pollInterval
        );

        try {
            // First, wait to get at least 1 confirmation, but throw an error if the transaction is stuck
            // (that is, new blocks are coming, but the transaction is not included)
            await Promise.race([
                firstConfirmationPromise,
                firstConfirmationTimeoutPromise,
                noNewBlockPromise
            ]);
        } finally {
            // Make sure any pending CancellablePromise is released
            firstConfirmationPromise.cancel();
            firstConfirmationTimeoutPromise.cancel();
            noNewBlockPromise.cancel();
        }
    }


    /**
     * Resolves after the transaction `txHash` receives `confirmationsRequired`.
     * Rejects with `NoNewBlockError` the provider does not receive a new block for `newBlockTimeout` milliseconds (starting from `timeLastBlockReceived`).
     * Rejects with `ReorgError` if the transaction is not found by the provider.
     */
    public async waitForEnoughConfirmations(txHash: string, timeLastBlockReceived: number) {
        // Promise that waits for enough confirmations before declaring success
        const enoughConfirmationsPromise = waitForConfirmations(this.provider, txHash, this.confirmationsRequired, true);

        // ...but stop with error if no new blocks come for too long
        const noNewBlockPromise = rejectIfAnyBlockTimesOut(
            this.provider,
            timeLastBlockReceived,
            this.newBlockTimeout,
            this.pollInterval
        );

        try {
            // Then, wait to get at enough confirmations; now only throw an error if there is a reorg
            await Promise.race([
                enoughConfirmationsPromise,
                noNewBlockPromise
            ]);
        } finally {
            // Make sure any pending CancellablePromise is released
            enoughConfirmationsPromise.cancel();
            noNewBlockPromise.cancel();
        }
    }
}

/**
 * This responder can only handle one response. The wallet used by this responder should not be used for any other purpose
 * until the end of the response flow (that is, until the event `responseConfirmed` is emitted).
 */
export class EthereumDedicatedResponder extends EthereumResponder {
    // Waiting time before retrying, in milliseconds
    public static readonly WAIT_TIME_BETWEEN_ATTEMPTS = 1000;

    // Waiting time before considering a request to the provider failed, in milliseconds
    public static readonly WAIT_TIME_FOR_PROVIDER_RESPONSE = 30*1000;

    // Waiting time before throwing an error if no new blocks are received, in milliseconds
    public static readonly WAIT_TIME_FOR_NEW_BLOCK = 120*1000;

    // Number of blocks to wait for the first confirmation
    public static readonly WAIT_BLOCKS_BEFORE_RETRYING = 20;

    private locked = false; // Lock to prevent this responder from accepting multiple requests

    // Timestamp in milliseconds when the last block was received (or since the creation of this object)
    private timeLastBlockReceived: number;

    private transactionMiner: EthereumTransactionMiner;

    /**
     * @param signer The signer of the wallet associated with this responder. Each responder should have exclusive access to his wallet.
     * @param [confirmationsRequired] The number of confirmations required before a transaction is trusted.
     * @param [maxAttempts] The maximum number of retries before the Responder will give up.
     */
    constructor(
        signer: ethers.Signer,
        private readonly gasPolicy: IGasPolicy,
        public readonly confirmationsRequired: number,
        private readonly maxAttempts: number,
        transactionMiner?: EthereumTransactionMiner
    ) {
        super(signer);

        this.transactionMiner = transactionMiner || new EthereumTransactionMiner(
            this.signer,
            this.confirmationsRequired,
            EthereumDedicatedResponder.WAIT_BLOCKS_BEFORE_RETRYING,
            EthereumDedicatedResponder.WAIT_TIME_FOR_NEW_BLOCK,
            1000
        );
    }

    // Makes sure that the class is locked while `fn` is running, and that any listener is registered and cleared correctly
    private async withLock(fn: () => Promise<any>) {
        if (this.locked) {
            throw new ApplicationError("This responder can ony handle one response at a time."); // TODO:93: more specific Error type?
        }

        this.locked = true;

        const listener = this.newBlockReceived.bind(this);
        this.provider.on("block", listener);

        this.timeLastBlockReceived = Date.now();

        try {
            await fn();
        } finally {
            this.provider.removeListener("block", listener);
            this.locked = false;
        }
    }

    private newBlockReceived() {
        this.timeLastBlockReceived = Date.now();
    }

    public async startResponse(appointmentId: string, responseData: IEthereumResponseData) {
        this.withLock(async () => {
            const cancellablePromises: CancellablePromise<any>[] = []; // Promises to cancel on cleanup to prevent memory leaks

            const responseFlow = new EthereumResponseFlow(appointmentId, responseData);

            const signerAddress = await this.signer.getAddress();

            // Get the current nonce to be used
            const nonce = await this.provider.getTransactionCount(signerAddress);

            // Get the initial gas price
            this.gasPrice = await this.gasPolicy.getInitialPrice();

            let attemptsDone = 0;
            while (attemptsDone < this.maxAttempts) {
                attemptsDone++;
                try {
                    // Try to call submitStateFunction, but timeout with an error if
                    // there is no response for WAIT_TIME_FOR_PROVIDER_RESPONSE ms.
                    const txRequest = this.prepareTransactionRequest(responseData, nonce);

                    const txHash = await this.transactionMiner.sendTransaction(txRequest);

                    // Emit the ResponseSent event
                    responseFlow.state = ResponseState.ResponseSent;
                    responseFlow.txHash = txHash;
                    this.asyncEmit(ResponderEvent.ResponseSent, responseFlow, attemptsDone);

                    await this.transactionMiner.waitForFirstConfirmation(txHash, this.timeLastBlockReceived);

                    await this.transactionMiner.waitForEnoughConfirmations(txHash, this.timeLastBlockReceived);

                    // The response has now enough confirmations to be considered safe.
                    responseFlow.state = ResponseState.Success;
                    this.asyncEmit(ResponderEvent.ResponseConfirmed, responseFlow, attemptsDone);

                    return;
                } catch (doh) {
                    if (doh instanceof BlockThresholdReachedError) {
                        // Bump the gas price before the next attempt
                        this.gasPrice = this.gasPolicy.getIncreasedGasPrice(this.gasPrice);

                        this.asyncEmit(
                            ResponderEvent.AttemptFailed,
                            responseFlow,
                            new StuckTransactionError(
                                `Transaction not mined after ${EthereumDedicatedResponder.WAIT_BLOCKS_BEFORE_RETRYING} blocks.`
                            )
                        );
                    } else {
                        this.asyncEmit(ResponderEvent.AttemptFailed, responseFlow, doh, attemptsDone);
                    }
                } finally {
                    // Make sure any pending CancellablePromise is released
                    for (let p of cancellablePromises) {
                        p.cancel();
                    }
                }

                // TODO: does waiting a longer time before retrying help in any way?
                await wait(EthereumDedicatedResponder.WAIT_TIME_BETWEEN_ATTEMPTS);
            }
            responseFlow.state = ResponseState.Failed;
            this.asyncEmit(ResponderEvent.ResponseFailed, responseFlow, attemptsDone);
        });
    }
}


/**
 * Responsible for handling the business logic of the Responders.
 */
// TODO: This is a mock class and only correctly handles one active response.
//       Should add a pool of wallets to allow concurrent responses.

export class EthereumResponderManager {
    private provider: ethers.providers.Provider;
    private responders: Set<EthereumResponder> = new Set();
    private gasPolicy: IGasPolicy;

    constructor(private readonly signer: ethers.Signer) {
        if (!signer.provider) throw new ArgumentError("The given signer is not connected to a provider");

        this.provider = signer.provider;

        this.gasPolicy = new DoublingGasPolicy(this.provider);
    }

    public respond(appointment: IEthereumAppointment) {
        const ethereumResponseData = appointment.getResponseData();

        const responder = new EthereumDedicatedResponder(this.signer, this.gasPolicy, 40, 10);
        this.responders.add(responder);
        responder
            .on(ResponderEvent.ResponseSent, (responseFlow: ResponseFlow, attemptNumber: number) => {
                logger.info(
                    `Successfully responded to appointment ${appointment.id} on attempt #${attemptNumber}. Waiting for enough confirmations.`
                );

                // TODO: Should we store information about past responders anywhere?
                this.responders.delete(responder);
            })
            .on(ResponderEvent.ResponseConfirmed, (responseFlow: ResponseFlow, attemptNumber: number) => {
                logger.info(
                    `Successfully responded to appointment ${appointment.id} after ${attemptNumber} ${plural(attemptNumber, "attempt")}.`
                );

                // Should we keep inactive responders anywhere?
                this.responders.delete(responder);
            })
            .on(ResponderEvent.AttemptFailed, (responseFlow: ResponseFlow, doh: Error, attemptNumber: number) => {
                logger.error(
                    `Failed to respond to appointment ${appointment.id}; ${attemptNumber} ${plural(attemptNumber, "attempt")}.`
                );
                logger.error(doh);
            })
            .on(ResponderEvent.ResponseFailed, (responseFlow: ResponseFlow, attempts: number) => {
                logger.error(
                    `Failed to respond to ${appointment.id}, after ${attempts} ${plural(attempts, "attempt")}. Giving up.`
                );

                // TODO: this is serious and should be escalated.
            })
            .startResponse(appointment.id, ethereumResponseData);
    }
}
