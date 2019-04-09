import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { wait } from './utils';
import { IAppointment, IEthereumResponse } from "./dataEntities/appointment";
import logger from "./logger";
import { TransactionResponse } from 'ethers/providers';

/**
 * Responsible for storing the state and managing the flow of a single response.
 */
export class ResponseFlow {
    private static nextId: number = 0;

    readonly id: number;
    readonly creationTimestamp: number;
    public attempts: number = 0; // number of attempts already made

    public status = ResponseStatus.Started;

    constructor() {
        this.id = ResponseFlow.nextId++;
        this.creationTimestamp = Date.now();
    }
}

/**
 * Represents the current state of a Response
 */
export enum ResponseStatus {
    Started,      // flow started
    ResponseSent, // responded, but waiting for enough confirmations
    Success,      // responded with enough confirmations
    Failed        // response flow failed
}

/**
 * Responsible for responding to observed events.
 * The responder is solely responsible for ensuring that a transaction gets to the blockchain.
 */
export abstract class Responder extends EventEmitter {
    private responses = new Map<number, ResponseFlow>();

    /**
     *
     * @param maxAttempts The maximum number of retries before the Responder will give up
     */
    constructor(
        protected readonly maxAttempts: number
    ) {
        super();
    }

    /**
     * Creates a new Response object, initiating the flow of submitting state to the blockchain.
     */
    startResponse(): ResponseFlow {
        const responseFlow = new ResponseFlow();
        this.responses[responseFlow.id] = responseFlow;

        this.respond(responseFlow);

        return responseFlow;
    }


    // Commodity function to emit events asynchronously
    protected asyncEmit(...args: any[]) {
        setImmediate( () => this.emit.call(this, args) );
    }

    /**
     * This function tries to submit the transaction that resolves the dispute, protecting the channel.
     */
    protected abstract submitStateFunction(): Promise<any>;

    /**
     * Implements the strategy of this responder.
     *
     * @param responseFlow The ResponseFlow object of this response.
     */
    protected abstract respond(responseFlow: ResponseFlow): Promise<any>;
}

/**
 * A simple custom Error cluss to provide more details in case of a re-org.
 */
class ReorgError extends Error {
    constructor(public readonly tx: TransactionResponse, ...params: any) {
        super(...params);
        this.name = "ReorgError";
    }
}

export class EthereumResponder extends Responder {
    protected readonly contract: ethers.Contract;

    /**
     * @param signer The signer of the wallet associated with this responder. Each responder should have exclusive access to his wallet.
     * @param appointmentId The id of the Appointment this object is responding to.
     * @param ethereumResponse The IEthereumResponse containing what needs to be submitted.
     * @param confirmationsRequired The number of confirmations required before a transaction is trusted. Default: 40.
     * @param maxAttempts The maximum number of retries before the Responder will give up.
     * TODO: docs
     */
    constructor(
        readonly signer: ethers.Signer,
        public readonly appointmentId: string,
        public readonly ethereumResponse: IEthereumResponse,

        public readonly confirmationsRequired = 40,
        maxAttempts: number
    ) {
        super(maxAttempts);
    }

    protected submitStateFunction(): Promise<TransactionResponse> {
        // form the interface so that we can serialise the args and the function name
        const abiInterface = new ethers.utils.Interface(this.ethereumResponse.contractAbi);
        const data = abiInterface.functions[this.ethereumResponse.functionName].encode(this.ethereumResponse.functionArgs);
        // now create a transaction, specifying possible oher variables
        const transactionRequest = {
            to: this.ethereumResponse.contractAddress,
            // gasLimit: 0,
            // nonce: 0,
            gasPrice: 21000000000, //TODO: chose an appropriate gas price
            data: data
        };

        // execute the transaction
        return this.signer.sendTransaction(transactionRequest);
    }

    protected async respond(responseFlow: ResponseFlow) {
        while (responseFlow.attempts < this.maxAttempts) {
            responseFlow.attempts++;
            try {
                const tx = await this.submitStateFunction();

                responseFlow.status = ResponseStatus.ResponseSent;
                this.asyncEmit("responseSent", responseFlow);

                // Wait for enough confirmations before declaring success
                await new Promise((resolve, reject) => {
                    const provider = this.signer.provider;
                    const newBlockHandler = async () => {
                        const receipt = await provider.getTransactionReceipt(tx.hash);
                        if (receipt == null) {
                            // There was a re-org, consider this attempt failed and attempt the transaction again
                            provider.removeListener("block", newBlockHandler);
                            reject(new ReorgError(tx, "There could have been a re-org, the transaction was sent but was later not found."));
                        } else if (receipt.confirmations >= this.confirmationsRequired) {
                            provider.removeListener("block", newBlockHandler);
                            resolve();
                        }
                    };
                    provider.on("block", newBlockHandler);
                });

                responseFlow.status = ResponseStatus.Success;
                console.log("responseConfirmed");
                this.asyncEmit("responseConfirmed", responseFlow);

                return;
            } catch (doh) {

                console.log("attemptFailed");
                this.asyncEmit("attemptFailed", responseFlow, doh);

                //TODO: implement a proper strategy
                await wait(1000);
            }
        }

        console.log("responseFailed");
        this.asyncEmit("responseFailed", responseFlow);
    }
}

/**
 * Responsible for handling the business logic of the Responders.
 */
// TODO: only correctly handling one active response.
//       Should add a pool of wallets to allow concurrent responses.

export class EthereumResponderManager {
    private responders: Set<Responder> = new Set();

    constructor(private readonly signer: ethers.Signer, private readonly config: object) {

    }

    public respond(appointment: IAppointment) {
        if (!(appointment.type in this.config)){
            throw new Error(`Received unexpected appointment type ${appointment.type}`);
        }

        const ethereumResponse = this.config[appointment.type](appointment) as IEthereumResponse;

        const responder = new EthereumResponder(this.signer, "TODO: appointment ID", ethereumResponse, 10);

        this.responders.add(responder);

        responder
            .on("responseSent", (responseFlow: ResponseFlow) => {
                logger.info(
                    `Successfully responded to appointment ${"TODO: appointment ID"} after ${responseFlow.attempts} attempt${responseFlow.attempts > 1 ? "s" : ""}.
                     Waiting for enough confirmations (${EthereumResponder.CONFIRMATIONS_REQUIRED}).`
                );

                // TODO: Should we store information about past responders anywhere?
                this.responders.delete(responder);
            })
            .on("responseConfirmed", (responseFlow: ResponseFlow) => {
                logger.info(
                    `Successfully responded to appointment ${"TODO: appointment ID"} after ${responseFlow.attempts} attempt${responseFlow.attempts > 1 ? "s" : ""}.`
                );

                // Should we keep inactive responders anywhere?
                this.responders.delete(responder);
            })
            .on("attemptFailed", (responseFlow: ResponseFlow, doh) => {
                logger.error(
                    `Failed to respond to appointment ${"TODO: appointment ID"}; ${responseFlow.attempts} attempt${responseFlow.attempts > 1 ? "s" : ""}.`
                );
                logger.error(doh);
            })
            .on("responseFailed", (responseFlow: ResponseFlow) => {
                logger.error(
                    `Failed to respond to ${"TODO: appointment ID"}, after ${responseFlow.attempts} attempt${responseFlow.attempts > 1 ? "s" : ""}. Giving up.`
                );

                //TODO: this is serious and should be escalated.
            });

        responder.startResponse();
    }
}
