import { EventEmitter } from "events";
import { ethers } from "ethers";
import { wait, waitFor, promiseTimeout, plural } from "./utils";
import { waitForConfirmations, ReorgError } from "./utils/ethers";
import { IEthereumAppointment, IEthereumResponseData } from "./dataEntities/appointment";
import logger from "./logger";
import { TransactionResponse } from "ethers/providers";

/**
 * Responsible for storing the state and managing the flow of a single response.
 */
// TODO:93: This class and ResponseState are not currently used in any meaningful way.
//          The plan is to use them for accounting, make sure this is the case.
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
    public txHash: string = null; // if a transaction has been sent, this is its hash
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
 * A simple custom Error class to signal that no new block was received while we
 * were waiting for a transaction to be mined. This might likely signal a failure of
 * the provider.
 */
export class NoNewBlockError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "NoNewBlockError";
    }
}

/**
 * A simple custom Error class to signal that new blocks are being received, but the transaction
 * is not being mined, suggesting it might be necessary to bump the gas price.
 */
export class StuckTransactionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StuckTransactionError";
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

    constructor(public readonly signer: ethers.Signer) {
        super();
    }

    protected submitStateFunction(responseData: IEthereumResponseData, nonce: number = null): Promise<TransactionResponse> {
        // form the interface so that we can serialise the args and the function name
        const abiInterface = new ethers.utils.Interface(responseData.contractAbi);
        const data = abiInterface.functions[responseData.functionName].encode(responseData.functionArgs);
        // now create a transaction, specifying possible oher variables
        const transactionRequest = {
            to: responseData.contractAddress,
            gasLimit: EthereumResponder.GAS_LIMIT,
            nonce: nonce,
            gasPrice: this.gasPrice,
            data: data
        };

        // execute the transaction
        return this.signer.sendTransaction(transactionRequest);
    }

    /**
    * @param appointmentId The id of the Appointment this object is responding to.
    * @param response The IEthereumResponse containing what needs to be submitted.
    */
    public abstract startResponse(appointmentId: string, responseData: IEthereumResponseData): void;
}


/* CONCRETE RESPONDER IMPLEMENTATIONS */

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
    private lastBlockNumberSeen: number;
    private timeLastBlockReceived: number;

    /**
     * @param signer The signer of the wallet associated with this responder. Each responder should have exclusive access to his wallet.
     * @param [confirmationsRequired] The number of confirmations required before a transaction is trusted.
     * @param [maxAttempts] The maximum number of retries before the Responder will give up.
     */
    constructor(
        signer: ethers.Signer,
        public readonly confirmationsRequired,
        private readonly maxAttempts: number
    ) {
        super(signer);
    }

    // Makes sure that the class is locked while `fn` is running, and that any listener is registered and cleared correctly
    private async withLock(fn: () => Promise<any>) {
        if (this.locked) {
            throw new Error("This responder can ony handle one response at a time."); // TODO:93: more specific Error type?
        }

        this.locked = true;

        const listener = this.newBlockReceived.bind(this);
        this.signer.provider.on("block", listener);

        this.lastBlockNumberSeen = 0;
        this.timeLastBlockReceived = Date.now();

        try {
            await fn();
        } finally {
            this.signer.provider.removeListener("block", listener);
            this.locked = false;
        }
    }

    private newBlockReceived(blockNumber: number) {
        this.lastBlockNumberSeen = blockNumber;
        this.timeLastBlockReceived = Date.now();
    }

    public async startResponse(appointmentId: string, responseData: IEthereumResponseData) {
        this.withLock(async () => {
            const responseFlow = new EthereumResponseFlow(appointmentId, responseData);

            const signerAddress = await promiseTimeout(
                this.signer.getAddress(),
                EthereumDedicatedResponder.WAIT_TIME_FOR_PROVIDER_RESPONSE
            );

            // Get the current nonce to be used
            const nonce = await promiseTimeout(
                this.signer.provider.getTransactionCount(signerAddress),
                EthereumDedicatedResponder.WAIT_TIME_FOR_PROVIDER_RESPONSE
            );

            // Get the initial gas price
            this.gasPrice = await promiseTimeout(
                this.signer.provider.getGasPrice(),
                EthereumDedicatedResponder.WAIT_TIME_FOR_PROVIDER_RESPONSE
            );

            let attemptsDone = 0;
            while (attemptsDone < this.maxAttempts) {
                attemptsDone++;
                try {
                    // Try to call submitStateFunction, but timeout with an error if
                    // there is no response for WAIT_TIME_FOR_PROVIDER_RESPONSE ms.
                    const tx = await promiseTimeout(
                        this.submitStateFunction(responseData, nonce),
                        EthereumDedicatedResponder.WAIT_TIME_FOR_PROVIDER_RESPONSE
                    );

                    // The response has been sent, but should not be considered confirmed yet.
                    responseFlow.state = ResponseState.ResponseSent;
                    responseFlow.txHash = tx.hash;
                    this.asyncEmit(ResponderEvent.ResponseSent, responseFlow);


                    // Last block seen when transaction was first sent
                    const txSentBlockNumber = this.lastBlockNumberSeen;

                    // Promise that waits for the first confirmation
                    const firstConfirmationPromise = waitForConfirmations(this.signer.provider, tx.hash, 1);

                    // Promise that rejects after WAIT_BLOCKS_BEFORE_RETRYING blocks are mined since the transaction was first sent
                    const firstConfirmationTimeoutPromise = new Promise((_, reject) => {
                        const testCondition = () => {
                            if (this.lastBlockNumberSeen > txSentBlockNumber + EthereumDedicatedResponder.WAIT_BLOCKS_BEFORE_RETRYING) {
                                reject(new StuckTransactionError(`Transaction still not mined after ${this.lastBlockNumberSeen - txSentBlockNumber} blocks`));
                            } else {
                                setTimeout(testCondition, 1000);
                            }
                        }
                        testCondition();
                    });

                    // Promise that waits for enough confirmations before declaring success
                    const enoughConfirmationsPromise = waitForConfirmations(this.signer.provider, tx.hash, this.confirmationsRequired);

                    // ...but stop with error if no new blocks come for too long
                    // TODO: make sure this does not cause memory leaks
                    const noNewBlockPromise = new Promise((_, reject) => {
                        const testCondition = () => {
                            // milliseconds since the last block was received (or the responder was instantiated)
                            const msSinceLastBlock = Date.now() - this.timeLastBlockReceived;
                            if (msSinceLastBlock > EthereumDedicatedResponder.WAIT_TIME_FOR_NEW_BLOCK) {
                                reject(new NoNewBlockError(`No new block was received for ${Math.round(msSinceLastBlock/1000)} seconds; provider might be down.`));
                            } else {
                                setTimeout(testCondition, 1000);
                            }
                        };
                        testCondition();
                    });


                    // First, wait to get at least 1 confirmation, but throw an error if the transaction is stuck
                    // (that is, new blocks are coming, but the transaction is not included)
                    await Promise.race([
                        firstConfirmationPromise,
                        firstConfirmationTimeoutPromise,
                        noNewBlockPromise
                    ]);

                    // Then, wait to get at enough confirmations; now only throw an error if there is a reorg
                    await Promise.race([
                        enoughConfirmationsPromise,
                        noNewBlockPromise
                    ]);

                    // The response has now enough confirmations to be considered safe.
                    responseFlow.state = ResponseState.Success;
                    this.asyncEmit(ResponderEvent.ResponseConfirmed, responseFlow);

                    return;
                } catch (doh) {
                    this.asyncEmit(ResponderEvent.AttemptFailed, responseFlow, doh);

                    if (doh instanceof StuckTransactionError) {
                        // Double the gas price before the next attempt
                        // TODO: think of better strategies (e.g.: check network conditions again)
                        this.gasPrice = this.gasPrice.mul(2);
                    }

                    // TODO: does waiting a longer time before retrying help in any way?
                    await wait(EthereumDedicatedResponder.WAIT_TIME_BETWEEN_ATTEMPTS);
                }
            }
            responseFlow.state = ResponseState.Failed;
            this.asyncEmit(ResponderEvent.ResponseFailed, responseFlow);
        });
    }
}


/**
 * Responsible for handling the business logic of the Responders.
 */
// TODO: This is a mock class and only correctly handles one active response.
//       Should add a pool of wallets to allow concurrent responses.

export class EthereumResponderManager {
    private responders: Set<EthereumResponder> = new Set();

    constructor(private readonly signer: ethers.Signer) {

    }

    public respond(appointment: IEthereumAppointment) {
        const ethereumResponseData = appointment.getResponseData();

        const responder = new EthereumDedicatedResponder(this.signer, 40, 10);
        this.responders.add(responder);
        let attemptsDone = 0;
        responder
            .on(ResponderEvent.ResponseSent, (responseFlow: ResponseFlow) => {
                logger.info(
                    `Successfully responded to appointment ${appointment.id}. Waiting for enough confirmations.`
                );

                // TODO: Should we store information about past responders anywhere?
                this.responders.delete(responder);
            })
            .on(ResponderEvent.ResponseConfirmed, (responseFlow: ResponseFlow) => {
                attemptsDone++;
                logger.info(
                    `Successfully responded to appointment ${appointment.id} after ${attemptsDone} ${plural(attemptsDone, "attempt")}.`
                );

                // Should we keep inactive responders anywhere?
                this.responders.delete(responder);
            })
            .on(ResponderEvent.AttemptFailed, (responseFlow: ResponseFlow, doh) => {
                attemptsDone++;
                logger.error(
                    `Failed to respond to appointment ${appointment.id}; ${attemptsDone} ${plural(attemptsDone, "attempt")}.`
                );
                logger.error(doh);
            })
            .on(ResponderEvent.ResponseFailed, (responseFlow: ResponseFlow) => {
                logger.error(
                    `Failed to respond to ${appointment.id}, after ${attemptsDone} ${plural(attemptsDone, "attempt")}. Giving up.`
                );

                // TODO: this is serious and should be escalated.
            })
            .startResponse(appointment.id, ethereumResponseData);
    }
}
