import { EventEmitter } from "events";
import { ethers } from "ethers";
import { wait, promiseTimeout, plural } from "./utils";
import { waitForConfirmations } from "./utils/ethers";
import { IEthereumAppointment, IEthereumResponse } from "./dataEntities/appointment";
import logger from "./logger";
import { TransactionResponse } from "ethers/providers";

/**
 * Responsible for storing the state and managing the flow of a single response.
 */
// TODO-93: This class and ResponseState are not currently used in any meaningful way.
//          The plan is to use them for accounting, make sure this is the case.
export class ResponseFlow {
    private static nextId: number = 0;

    readonly id: number;
    readonly creationTimestamp: number;

    public status = ResponseState.Started;

    constructor() {
        this.id = ResponseFlow.nextId++;
        this.creationTimestamp = Date.now();
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
    public readonly responseFlow: ResponseFlow;
    /**
     * Creates a new Response object, initiating the flow of submitting state to the blockchain.
     */
    constructor() {
        super();
        this.responseFlow = new ResponseFlow();
    }

    // Commodity function to emit events asynchronously
    protected asyncEmit(...args: any[]): Promise<boolean> {
        return new Promise(resolve => resolve(this.emit.apply(this, args)))
    }

    /**
     * This function tries to submit the transaction that resolves the dispute, protecting the channel.
     */
    protected abstract submitStateFunction(): Promise<any>;

    /**
     * Initiates the response, implementing the strategy of this responder.
     *
     * @param responseFlow The ResponseFlow object of this response.
     */
    public abstract respond(): Promise<any>;
}

/**
 * A simple custom Error class to signal that no new block was received while we
 * were waiting for a transaction to be mined. This might likely signal a failure of
 * the provider.
 */
class NoNewBlockError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "NoNewBlockError";
    }
}

/**
 * A generic abstract responder for the Ethereum blockchain.
 * It implements the submitStateFunction, but no strategy.
 */
export abstract class EthereumResponder extends Responder {
    // TODO-93: the correct gas limit should be provided based on the appointment/integration.
    //          200000 is enough for Kitsune and Raiden (see https://github.com/raiden-network/raiden-contracts/blob/master/raiden_contracts/data/gas.json).
    private static GAS_LIMIT = 200000;
    /**
     * @param signer The signer of the wallet associated with this responder. Each responder should have exclusive access to his wallet.
     * @param appointmentId The id of the Appointment this object is responding to.
     * @param ethereumResponse The IEthereumResponse containing what needs to be submitted.
     */
    constructor(
        readonly signer: ethers.Signer,
        public readonly appointmentId: string,
        public readonly ethereumResponse: IEthereumResponse
    ) {
        super();
    }

    protected submitStateFunction(): Promise<TransactionResponse> {
        // form the interface so that we can serialise the args and the function name
        const abiInterface = new ethers.utils.Interface(this.ethereumResponse.contractAbi);
        const data = abiInterface.functions[this.ethereumResponse.functionName].encode(this.ethereumResponse.functionArgs);
        // now create a transaction, specifying possible oher variables
        const transactionRequest = {
            to: this.ethereumResponse.contractAddress,
            gasLimit: EthereumResponder.GAS_LIMIT,
            // nonce: 0,
            gasPrice: 21000000000, // TODO: choose an appropriate gas price
            data: data
        };

        // execute the transaction
        return this.signer.sendTransaction(transactionRequest);
    }
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
    public static readonly WAIT_TIME_FOR_PRIVDER_RESPONSE = 30000;


    // Timestamp in milliseconds when the last block was received (or since the creation of this object)
    private timeLastBlockReceived: number = Date.now();
    private mAttemptsDone: number = 0;

    get attemptsDone() {
        return this.mAttemptsDone;
    }

    /**
     * @param signer The signer of the wallet associated with this responder. Each responder should have exclusive access to his wallet.
     * @param appointmentId The id of the Appointment this object is responding to.
     * @param ethereumResponse The IEthereumResponse containing what needs to be submitted.
     * @param [confirmationsRequired=40] The number of confirmations required before a transaction is trusted.
     * @param [maxAttempts=10] The maximum number of retries before the Responder will give up.
     */
    constructor(
        readonly signer: ethers.Signer,
        public readonly appointmentId: string,
        public readonly ethereumResponse: IEthereumResponse,

        public readonly confirmationsRequired = 40,
        private readonly maxAttempts: number = 10
    ) {
        super(signer, appointmentId, ethereumResponse);

        signer.provider.on("block", this.updateLastBlockTime);
    }

    /**
     * Release any resources used by this instance.
     */
    private destroy() {
        this.signer.provider.removeListener("block", this.updateLastBlockTime);
    }

    private updateLastBlockTime() {
        this.timeLastBlockReceived = Date.now();
    }

    public async respond() {
        while (this.mAttemptsDone < this.maxAttempts) {
            this.mAttemptsDone++;
            try {
                // Try to call submitStateFunction, but timeout with an error if
                // there is no response for 30 seconds.
                const tx = await promiseTimeout(this.submitStateFunction(), EthereumDedicatedResponder.WAIT_TIME_FOR_PRIVDER_RESPONSE);

                // The response has been sent, but should not be considered confirmed yet.
                this.responseFlow.status = ResponseState.ResponseSent;
                this.asyncEmit(ResponderEvent.ResponseSent, this.responseFlow);

                // Wait for enough confirmations before declaring success
                const confirmationsPromise = waitForConfirmations(this.signer.provider, tx.hash, this.confirmationsRequired);
                // ...but stop with error if no new blocks come for too long
                const noNewBlockPromise = new Promise((_, reject) => {
                    const intervalHandle = setInterval( () => {
                        // milliseconds since the last block was received (or the responder was instantiated)
                        const msSinceLastBlock = Date.now() - this.timeLastBlockReceived;
                        if (msSinceLastBlock > 60*1000) {
                            clearInterval(intervalHandle)
                            reject(new NoNewBlockError(`No new block was received for ${Math.round(msSinceLastBlock/1000)} seconds; provider might be down.`));
                        }
                    }, 1000);
                });

                await Promise.race([confirmationsPromise, noNewBlockPromise]);

                // The response has now enough confirmations to be considered safe.
                this.responseFlow.status = ResponseState.Success;
                this.asyncEmit(ResponderEvent.ResponseConfirmed, this.responseFlow);

                this.destroy();

                return;
            } catch (doh) {
                this.asyncEmit(ResponderEvent.AttemptFailed, this.responseFlow, doh);

                // TODO: does waiting a longer time before retrying help in any way?
                await wait(EthereumDedicatedResponder.WAIT_TIME_BETWEEN_ATTEMPTS);
            }
        }
        this.responseFlow.status = ResponseState.Failed;
        this.asyncEmit(ResponderEvent.ResponseFailed, this.responseFlow);
        this.destroy();
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
        const ethereumResponse = appointment.getResponse();

        const responder = new EthereumDedicatedResponder(this.signer, appointment.id, ethereumResponse, 10);
        this.responders.add(responder);
        responder
            .on(ResponderEvent.ResponseSent, (responseFlow: ResponseFlow) => {
                logger.info(
                    `Successfully responded to appointment ${appointment.id} after ${responder.attemptsDone} ${plural(responder.attemptsDone, "attempt")}.
                     Waiting for enough confirmations.`
                );

                // TODO: Should we store information about past responders anywhere?
                this.responders.delete(responder);
            })
            .on(ResponderEvent.ResponseConfirmed, (responseFlow: ResponseFlow) => {
                logger.info(
                    `Successfully responded to appointment ${appointment.id} after ${responder.attemptsDone} ${plural(responder.attemptsDone, "attempt")}.`
                );

                // Should we keep inactive responders anywhere?
                this.responders.delete(responder);
            })
            .on(ResponderEvent.AttemptFailed, (responseFlow: ResponseFlow, doh) => {
                logger.error(
                    `Failed to respond to appointment ${appointment.id}; ${responder.attemptsDone} ${plural(responder.attemptsDone, "attempt")}.`
                );
                logger.error(doh);
            })
            .on(ResponderEvent.ResponseFailed, (responseFlow: ResponseFlow) => {
                logger.error(
                    `Failed to respond to ${appointment.id}, after ${responder.attemptsDone} ${plural(responder.attemptsDone, "attempt")}. Giving up.`
                );

                // TODO: this is serious and should be escalated.
            })
            .respond();
    }
}
