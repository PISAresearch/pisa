import { ethers } from "ethers";
import { ChannelType } from "./channelType";
import uuid from "uuid/v4";

/**
 * An appointment that has been accepted by PISA
 *
 * @member startBlock: start block, when the appointment begins.
 * @member endBlock: end time, when the appointment ends.
 * @member passedInspection: true iff this appointment passed the inspection.
 * @member expiryPeriod: duration of the appointment in blocks.
 * @member type: one of the supported channel types.
 */
export interface IAppointment {
    startBlock: number;
    endBlock: number;
    passedInspection: boolean;
    expiryPeriod: number;
    type: ChannelType;
    id: string;
}

/**
 * Ethereum variant of IAppointment
 */
export interface IEthereumAppointment extends IAppointment {
    getStateLocator(): string;
    getContractAbi(): any;
    getContractAddress(): string;
    getEventFilter(): ethers.EventFilter;
    getEventName(): string;
    getStateIdentifier(): string;
    getStateNonce(): number;
    formatLog(message: string): string;
    getResponseFunctionName(): string;
    getResponseFunctionArgs(): any[];
    getResponseData(): IEthereumResponseData;
    getDBRepresentation(): any;
}

/**
 * An appointment that has been accepted by PISA
 */
export abstract class EthereumAppointment implements IEthereumAppointment {
    public readonly id: string;

    constructor(readonly expiryPeriod: number, readonly type: ChannelType, startBlock: number, endBlock: number) {
        this.id = uuid();
        if (startBlock) this.mStartBlock = startBlock;
        if (endBlock) this.mEndBlock = endBlock;
    }

    private mStartBlock: number;
    public get startBlock() {
        return this.mStartBlock;
    }
    private mEndBlock: number;
    public get endBlock() {
        return this.mEndBlock;
    }
    private mPassedInspection: boolean;
    public get passedInspection() {
        return this.mPassedInspection;
    }
    public passInspection(startBlock: number) {
        this.mPassedInspection = true;
        this.mStartBlock = startBlock;
        this.mEndBlock = startBlock + this.expiryPeriod;
    }
    public formatLog(message: string): string {
        return `|${this.getStateIdentifier()}| ${message}`;
    }

    /**
     * A combination of the state locator and the nonce for this state update
     */
    public getStateIdentifier() {
        return `${this.getStateLocator()}:${this.getStateNonce()}`;
    }

    /**
     * The minimum unique information required to identify the on-chain location of this state update
     */
    public abstract getStateLocator(): string;
    public abstract getContractAbi(): any;
    public abstract getContractAddress(): string;
    public abstract getEventFilter(): ethers.EventFilter;
    public abstract getEventName(): string;
    public abstract getStateNonce(): number;

    /**
     * The minimum unique information required form a response
     */
    public abstract getResponseFunctionName(): string;
    public abstract getResponseFunctionArgs(): any[];

    /**
     * Returns the IEthereumResponseData object for this appointment
     */
    public getResponseData(): IEthereumResponseData {
        return {
            contractAddress: this.getContractAddress(),
            contractAbi: this.getContractAbi(),
            functionName: this.getResponseFunctionName(),
            functionArgs: this.getResponseFunctionArgs()
        };
    }

    /**
     * All the information we need to save in the db
     */
    public getDBRepresentation() {
        return {
            ...this,
            startBlock: this.startBlock,
            endBlock: this.endBlock
        };
    }
}

/**
 * An appointment signed by PISA
 */
export class SignedAppointmnt {
    constructor(public readonly appointment: IEthereumAppointment, public readonly signature: string) {}
    public serialise() {
        const signedAppointment = {
            startBlock: this.appointment.startBlock,
            endBlock: this.appointment.endBlock,
            locator: this.appointment.getStateLocator(),
            nonce: this.appointment.getStateNonce(),
            signature: this.signature
        };

        return JSON.stringify(signedAppointment);
    }
}

/**
 * Represents the necessary data for an on-chain response from Pisa on the Ethereum blockchain.
 */
export interface IEthereumResponseData {
    contractAddress: string;
    contractAbi: any;
    functionName: string;
    functionArgs: any[];
}
