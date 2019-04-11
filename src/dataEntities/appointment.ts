import { ethers } from "ethers";
import { ChannelType } from "./channelType";
import uuid from "uuid/v4";

/**
 * An appointment that has been accepted by PISA
 *
 * @member startTime: start time, in milliseconds elapsed since January 1, 1970, 00:00:00 UTC.
 * @member endTime: end time, in milliseconds elapsed since January 1, 1970, 00:00:00 UTC.
 * @member passedInspection: true iff this appointment passed the inspection.
 * @member expiryPeriod: duration of the appointment in milliseconds.
 * @member type: one of the supported channel types.
 */
export interface IAppointment {
    startTime: number;
    endTime: number;
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
    getEventFilter(contract: ethers.Contract): ethers.EventFilter;
    getEventName(): string;
    getStateIdentifier(): string;
    getStateNonce(): number;
    formatLog(message: string): string;
}


/**
 * An appointment that has been accepted by PISA
 */
export abstract class EthereumAppointment implements IEthereumAppointment {
    public readonly id: string;
    
    constructor(readonly expiryPeriod: number, readonly type: ChannelType) {
        this.id = uuid();
    }
 
    private mStartTime: number;
    get startTime() {
        return this.mStartTime;
    }
    private mEndTime: number;
    get endTime() {
        return this.mEndTime;
    }
    private mPassedInspection: boolean;
    get passedInspection() {
        return this.mPassedInspection;
    }
    setInspectionResult(passed, startTime) {
        this.mPassedInspection = passed;
        if (passed) {
            this.mStartTime = startTime;
            this.mEndTime = startTime + this.expiryPeriod;
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
    abstract getEventFilter(contract: ethers.Contract);
    abstract getEventName(): string;
    abstract getStateNonce(): number;

    /**
     * The minimum unique information required form a response
     */
    abstract getResponseFunctionName(): string;
    abstract getResponseFunctionArgs(): any[];

    /**
     * Returns the IEthereumResponse object for this appointment
     */
    public getResponse(): IEthereumResponse {
        return {
            contractAddress: this.getContractAddress(),
            contractAbi: this.getContractAbi(),
            functionName: this.getResponseFunctionName(),
            functionArgs: this.getResponseFunctionArgs()
        };
    }
}

/**
 * Represents the necessary data for an on-chain response from Pisa on the Ethereum blockchain.
 */
export interface IEthereumResponse {
    contractAddress: string,
    contractAbi: any,
    functionName: string,
    functionArgs: any[]
}
