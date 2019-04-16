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
}


/**
 * An appointment that has been accepted by PISA
 */
export abstract class EthereumAppointment implements IEthereumAppointment {
    public readonly id: string;
    
    constructor(readonly expiryPeriod: number, readonly type: ChannelType) {
        this.id = uuid();
    }
 
    private mStartBlock: number;
    get startBlock() {
        return this.mStartBlock;
    }
    private mEndBlock: number;
    get endBlock() {
        return this.mEndBlock;
    }
    private mPassedInspection: boolean;
    get passedInspection() {
        return this.mPassedInspection;
    }
    setInspectionResult(passed, startBlock) {
        this.mPassedInspection = passed;
        if (passed) {
            this.mStartBlock = startBlock;
            this.mEndBlock = startBlock + this.expiryPeriod;
        }
    }
    formatLog(message: string): string {
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
    abstract getStateLocator(): string;
    abstract getContractAbi(): any;
    abstract getContractAddress(): string;
    abstract getEventFilter(): ethers.EventFilter;
    abstract getEventName(): string;
    abstract getStateNonce(): number;

    /**
     * The minimum unique information required form a response
     */
    abstract getResponseFunctionName(): string;
    abstract getResponseFunctionArgs(): any[];

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
}

/**
 * Base interface representing all the necessary information for a response from Pisa.
 */
export interface IResponseData {}

/**
 * Represents the necessary data for an on-chain response from Pisa on the Ethereum blockchain.
 */
export interface IEthereumResponseData extends IResponseData {
    contractAddress: string,
    contractAbi: any,
    functionName: string,
    functionArgs: any[]
}
