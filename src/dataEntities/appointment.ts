import { utils, ethers } from "ethers";
import RaidenTools from "../integrations/raiden/tools";
import KitsuneTools from "./../integrations/kitsune/tools";
import { ConfigurationError } from "./errors";
import { IAppointmentRequest, IKitsuneAppointmentRequest, IRaidenAppointmentRequest } from "./appointmentRequest";
import { IRaidenStateUpdate, IKitsuneStateUpdate } from "./stateUpdate";
import { ChannelType } from "./channelType";
import logger from "../logger";
import { inspect } from "util";

/**
 * An appointment that has been accepted by PISA
 */
export interface IAppointment {
    startTime: number;
    endTime: number;
    type: ChannelType;
    getStateLocator(): string;
    getContractAbi(): any;
    getContractAddress(): string;
    getEventFilter(contract: ethers.Contract): ethers.EventFilter;
    getEventName(): string;
    getStateIdentifier(): string;
    getStateNonce(): number;
    getSubmitStateFunction(): (contract: ethers.Contract, ...args: any[]) => Promise<void>;
}

/**
 * An appointment that has been accepted by PISA
 */
export abstract class Appointment implements IAppointment {
    constructor(readonly startTime: number, readonly endTime: number, readonly type: ChannelType) {}

    /**
     * A combination of the state locator and the nonce for this state update
     */
    public getStateIdentifier() {
        return `${this.getStateLocator()}:${this.getStateNonce()}`;
    }

    /**
     * The minimum unique information required to identify the on-chain location of this state update
     */
    abstract getStateLocator(): string;
    abstract getContractAbi(): any;
    abstract getContractAddress(): string;
    abstract getEventFilter(contract: ethers.Contract);
    abstract getEventName(): string;
    abstract getStateNonce(): number;
    abstract getSubmitStateFunction(): (contract: ethers.Contract, ...args: any[]) => Promise<void>;

    static fromAppointmentRequest(appointmentRequest: IAppointmentRequest, startTime: number) {
        logger.info("from appointment");
        logger.info(inspect(appointmentRequest));
        switch (appointmentRequest.type) {
            case ChannelType.Kitsune:
            
                const kitsune = appointmentRequest as IKitsuneAppointmentRequest;
                return new KitsuneAppointment(kitsune.stateUpdate, startTime, startTime + kitsune.expiryPeriod);
            case ChannelType.Raiden:
                const raiden = appointmentRequest as IRaidenAppointmentRequest;
                return new RaidenAppointment(raiden.stateUpdate, startTime, startTime + raiden.expiryPeriod);
            default:
                throw new ConfigurationError(`Unknown appointment request type ${appointmentRequest.type}.`);
        }
    }
}

/**
 * An appointment containing kitsune specific information
 */
export class KitsuneAppointment extends Appointment {
    constructor(readonly stateUpdate: IKitsuneStateUpdate, startTime: number, endTime: number) {
        super(startTime, endTime, ChannelType.Kitsune);
    }

    getStateNonce() {
        return this.stateUpdate.round;
    }

    getContractAddress() {
        return this.stateUpdate.contractAddress;
    }

    getStateLocator() {
        // in the kitsune paradigm a new contract is created for each state channel
        // and a single nonce is kept per channel

        return this.stateUpdate.contractAddress;
    }

    getEventFilter(contract: ethers.Contract) {
        return contract.filters.EventDispute(null);
    }

    getEventName() {
        return "EventDispute(uint256)";
    }

    getContractAbi() {
        return KitsuneTools.ContractAbi;
    }

    getSubmitStateFunction(): (contract: ethers.Contract, ...args: any[]) => Promise<void> {
        return async (contract: ethers.Contract) => {
            let sig0 = utils.splitSignature(this.stateUpdate.signatures[0]);
            let sig1 = utils.splitSignature(this.stateUpdate.signatures[1]);

            return await contract.setstate(
                [sig0.v - 27, sig0.r, sig0.s, sig1.v - 27, sig1.r, sig1.s],
                this.stateUpdate.round,
                this.stateUpdate.hashState
            );
        };
    }
}

/**
 * An appointment containing Raiden specific information
 */
export class RaidenAppointment extends Appointment {
    constructor(readonly stateUpdate: IRaidenStateUpdate, startTime: number, endTime: number) {
        super(startTime, endTime, ChannelType.Raiden);
    }

    getStateNonce() {
        return this.stateUpdate.nonce;
    }

    getContractAddress() {
        return this.stateUpdate.token_network_identifier;
    }

    getStateLocator() {
        // the raiden network has one contract per token - the token network
        // within this contract each pair of participants can have at most one channel between them - the channel identifier
        // within this channel each participant keeps a record of the state of how much they are owed by their counterparty
        // it is this balance that is submitted to pisa

        return `${this.stateUpdate.token_network_identifier}:${this.stateUpdate.channel_identifier}:${
            this.stateUpdate.closing_participant
        }`;
    }

    getEventFilter(contract: ethers.Contract) {
        return contract.filters.ChannelClosed(
            this.stateUpdate.channel_identifier,
            this.stateUpdate.closing_participant,
            null
        );
    }

    getEventName() {
        return `ChannelClosed(${this.stateUpdate.channel_identifier},${this.stateUpdate.closing_participant},uint256)`;
    }

    getContractAbi() {
        return RaidenTools.ContractAbi;
    }

    getSubmitStateFunction(): (contract: ethers.Contract, ...args: any[]) => Promise<void> {
        return async (contract: ethers.Contract) =>
            await contract.updateNonClosingBalanceProof(
                this.stateUpdate.channel_identifier,
                this.stateUpdate.closing_participant,
                this.stateUpdate.non_closing_participant,
                this.stateUpdate.balance_hash,
                this.stateUpdate.nonce,
                this.stateUpdate.additional_hash,
                this.stateUpdate.closing_signature,
                this.stateUpdate.non_closing_signature
            );
    }
}
