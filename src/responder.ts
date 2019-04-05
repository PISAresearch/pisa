import { EventEmitter } from 'events';
import { utils, ethers } from 'ethers';
import { wait } from './utils';
import { IAppointment, IEthereumAppointment } from "./dataEntities/appointment";
import { KitsuneAppointment } from "./integrations/kitsune";
import { RaidenAppointment } from "./integrations/raiden";
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
        private readonly maxAttempts: number
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
    private asyncEmit(...args: any[]) {
        setImmediate( () => this.emit.call(this, args) );
    }

    protected abstract submitStateFunction(): Promise<void>;

    /**
     * Execute the submit state function, doesn't throw errors
     */
    private async respond(responseFlow: ResponseFlow) {
        while (responseFlow.attempts < this.maxAttempts) {
            responseFlow.attempts++;
            try {
                await this.submitStateFunction();

                responseFlow.status = ResponseStatus.Success;

                this.asyncEmit("responseSuccessful", responseFlow);
                return;
            } catch (doh) {

                this.asyncEmit("attemptFailed", responseFlow, doh);

                //TODO: implement a proper strategy
                await wait(1000);
            }
        }
        this.asyncEmit("responseFailed", responseFlow);
    }
}

export abstract class EthereumResponder<T extends IEthereumAppointment> extends Responder {
    protected readonly contract: ethers.Contract;
    /**
     * @param appointment The IEthereumAppointment this object is responding to.
     * @param maxAttempts The maximum number of retries before the Responder will give up.
     * @param signer The signer of the wallet associated with this responder. Each responder should have exclusive access to his wallet.
     *
     */
    constructor(
        protected appointment: T,
        maxAttempts: number,
        protected readonly signer: ethers.Signer
    ) {
        super(maxAttempts);

        // Instantiate the contract, connected to the signer
        this.contract = new ethers.Contract(
            appointment.getContractAddress(),
            appointment.getContractAbi(),
            this.signer
        );
    }
}

export class RaidenResponder extends EthereumResponder<RaidenAppointment> {
    protected submitStateFunction(): Promise<void> {
        return this.contract.updateNonClosingBalanceProof(
            this.appointment.stateUpdate.channel_identifier,
            this.appointment.stateUpdate.closing_participant,
            this.appointment.stateUpdate.non_closing_participant,
            this.appointment.stateUpdate.balance_hash,
            this.appointment.stateUpdate.nonce,
            this.appointment.stateUpdate.additional_hash,
            this.appointment.stateUpdate.closing_signature,
            this.appointment.stateUpdate.non_closing_signature
        );
    }
}

export class KitsuneResponder extends EthereumResponder<KitsuneAppointment> {
    protected submitStateFunction(): Promise<void> {
        let sig0 = utils.splitSignature(this.appointment.stateUpdate.signatures[0]);
        let sig1 = utils.splitSignature(this.appointment.stateUpdate.signatures[1]);

        return this.contract.setstate(
            [sig0.v - 27, sig0.r, sig0.s, sig1.v - 27, sig1.r, sig1.s],
            this.appointment.stateUpdate.round,
            this.appointment.stateUpdate.hashState
        );
    }
}


/**
 * Responsible for handling the business logic of the Responders.
 */
// TODO: only handling Kitsune appointments for now, and only one active response.
//       Should add a pool of wallets to allow concurrent responses.

export class ResponderManager {
    private appointmentsByResponseId = new Map<number, IAppointment>();

    private responders: Set<Responder> = new Set();

    constructor(private readonly signer: ethers.Signer) {}

    public respond(appointment: IAppointment) {
        const responder = new KitsuneResponder(appointment as KitsuneAppointment, 10, this.signer);

        this.responders.add(responder)

        responder
            .on("responseSuccessful", (responseFlow: ResponseFlow) => {
                const appointment = this.appointmentsByResponseId[responseFlow.id];
                logger.info(
                    appointment.formatLogEvent(
                        `Successfully responded to ${appointment.getEventName()} for appointment ${appointment.getStateLocator()} after ${response.attempts} attempt${response.attempts > 1 ? "s" : ""}.`
                    )
                );

                // Should we keep inactive responders anywhere?
                this.responders.delete(responder);
            })
            .on("attemptFailed", (responseFlow: ResponseFlow, doh) => {
                const appointment = this.appointmentsByResponseId[responseFlow.id];
                logger.error(
                    appointment.formatLogEvent(
                        `Failed to respond to ${appointment.getEventName()} for appointment ${appointment.getStateLocator()}; ${response.attempts} attempt${response.attempts > 1 ? "s" : ""}.`
                    )
                );
                logger.error(doh);
            })
            .on("responseFailed", (responseFlow: ResponseFlow) => {
                const appointment = this.appointmentsByResponseId[responseFlow.id];
                logger.error(
                    `Failed to respond to ${appointment.getEventName()} for appointment ${appointment.getStateLocator()}, after ${response.attempts} attempt${response.attempts > 1 ? "s" : ""}. Giving up.`
                );

                //TODO: this is serious and should be escalated.
            });

        const response = responder.startResponse();
        this.appointmentsByResponseId[response.id] = appointment;
    }
}