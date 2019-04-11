import { ethers } from "ethers";
import { ChannelType } from "./channelType";
import uuid from "uuid/v4";

/**
 * An appointment that has been accepted by PISA
 */
export interface IAppointment {
    startTime: number;
    endTime: number;
    passedInspection: boolean;
    expiryPeriod: number;
    type: ChannelType;
    id: string;
    getStateLocator(): string;
    getContractAbi(): any;
    getContractAddress(): string;
    getEventFilter(contract: ethers.Contract): ethers.EventFilter;
    getEventName(): string;
    getStateIdentifier(): string;
    getStateNonce(): number;
    getSubmitStateFunction(): (contract: ethers.Contract) => Promise<void>;
    formatLog(message: string): string;
}

/**
 * An appointment that has been accepted by PISA
 */
export abstract class Appointment implements IAppointment {
    constructor(readonly expiryPeriod: number, readonly type: ChannelType) {
        this.id = uuid()
    }
    public readonly id: string;
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
    abstract getSubmitStateFunction(): (contract: ethers.Contract) => Promise<void>;
}