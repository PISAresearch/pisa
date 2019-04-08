import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { wait } from './utils';
import { IAppointment, IEthereumResponse } from "./dataEntities/appointment";
import logger from "./logger";

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
    Started,
    Success,
    Failed
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

    protected abstract submitStateFunction(): Promise<any>;

    /**
     * Implements the strategy of this responder.
     *
     * @param responseFlow The ResponseFlow object of this response.
     */
    protected abstract respond(responseFlow: ResponseFlow): Promise<any>;
}

export class EthereumResponder extends Responder {
    protected readonly contract: ethers.Contract;
    /**
     * @param signer The signer of the wallet associated with this responder. Each responder should have exclusive access to his wallet.
     * @param appointment The IEthereumAppointment this object is responding to.
     * @param maxAttempts The maximum number of retries before the Responder will give up.
     * TODO: docs
     */
    constructor(
        readonly signer: ethers.Signer,
        public readonly appointmentId: string,
        public readonly ethereumResponse: IEthereumResponse,

        maxAttempts: number
    ) {
        super(maxAttempts);
    }

    protected async submitStateFunction() {
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
        return await this.signer.sendTransaction(transactionRequest);
    }

    protected async respond(responseFlow: ResponseFlow) {
        while (responseFlow.attempts < this.maxAttempts) {
            responseFlow.attempts++;
            try {
                await this.submitStateFunction();

                responseFlow.status = ResponseStatus.Success;

                this.emit("responseSuccessful", responseFlow);
                return;
            } catch (doh) {

                this.emit("attemptFailed", responseFlow, doh);

                //TODO: implement a proper strategy
                await wait(1000);
            }
        }
        this.emit("responseFailed", responseFlow);
    }
}

/**
 * Responsible for handling the business logic of the Responders.
 */
// TODO: only handling Kitsune appointments for now, and only one active response.
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
            .on("responseSuccessful", (responseFlow: ResponseFlow) => {
                logger.info(
                    `Successfully responded to appointment ${"TODO: appointment ID"} after ${response.attempts} attempt${response.attempts > 1 ? "s" : ""}.`
                );

                // Should we keep inactive responders anywhere?
                this.responders.delete(responder);
            })
            .on("attemptFailed", (responseFlow: ResponseFlow, doh) => {
                logger.error(
                    `Failed to respond to appointment ${"TODO: appointment ID"}; ${response.attempts} attempt${response.attempts > 1 ? "s" : ""}.`
                );
                logger.error(doh);
            })
            .on("responseFailed", (responseFlow: ResponseFlow) => {
                logger.error(
                    `Failed to respond to ${"TODO: appointment ID"}, after ${response.attempts} attempt${response.attempts > 1 ? "s" : ""}. Giving up.`
                );

                //TODO: this is serious and should be escalated.
            });

        const response = responder.startResponse();
    }
}