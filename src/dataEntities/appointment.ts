import { ethers } from "ethers";
import { ChannelType } from "./channelType";
import uuid from "uuid/v4";

// /**
//  * An appointment that has been accepted by PISA
//  *
//  * @member startBlock: start block, when the appointment begins.
//  * @member endBlock: end time, when the appointment ends.
//  * @member passedInspection: true iff this appointment passed the inspection.
//  * @member expiryPeriod: duration of the appointment in blocks.
//  * @member type: one of the supported channel types.
//  */
// export interface IAppointment {
//     startBlock: number;
//     endBlock: number;
//     passedInspection: boolean;
//     expiryPeriod: number;
//     type: ChannelType;
//     id: string;
// }

export interface IAppointmentRequest {
    // the address of the external contract to which the data will be submitted
    readonly contractAddress: string;

    // the address of the customer hiring PISA
    readonly customerAddress: string;

    // the block at which the appointment starts
    readonly startBlock: number;

    // the block at which the appointment ends
    readonly endBlock: number;

    // if the trigger event is noticed, then this is the number of blocks which
    // PISA has to respond
    readonly challengePeriod: number;

    // an appointment id, supplied by the customer
    readonly id: string;

    // a counter that allows users to replace existing jobs
    // TODO:173: should this be set by the customer or pisa?
    readonly jobId: number;

    // the data to supply when calling the external address from inside the contract
    readonly data: string;

    // how much to refund the customer by, in wei
    readonly refund: number;

    // the amount of gas to use when calling the external contract with the provided data
    readonly gas: number;

    // an identifier for the dispute handler to be used in checking state during recourse
    readonly mode: number;

    // a human readable (https://blog.ricmoo.com/human-readable-contract-abis-in-ethers-js-141902f4d917) event abi
    readonly eventABI: string;

    // ABI encoded event arguments for the event
    readonly eventArgs: string;

    // the post-condition data to be passed to the dispute handler to verify whether
    // recourse is required
    readonly postCondition: string;
}

export interface IAppointment extends IAppointmentRequest {
    // the hash used for fair exchange of the appointment. The customer will be required to
    // reveal the pre-image of this to seek recourse, which will only be given to them upon payment
    paymentHash: string;
}

export class Appointment implements IAppointment {
    constructor(
        // the address of the external contract to which the data will be submitted
        public readonly contractAddress: string,
        public readonly customerAddress: string,
        public readonly startBlock: number,
        public readonly endBlock: number,
        public readonly challengePeriod: number,
        public readonly id: string,
        public readonly jobId: number,
        public readonly data: string,
        public readonly refund: number,
        public readonly gas: number,
        public readonly mode: number,
        public readonly eventABI: string,
        public readonly eventArgs: string,
        public readonly postCondition: string,
        public readonly paymentHash: string
    ) {}
    // TODO:173: docs in this whole file need reviewing

    public static fromIAppointment(appointment: IAppointment): Appointment {
        return new Appointment(
            appointment.contractAddress,
            appointment.customerAddress,
            appointment.startBlock,
            appointment.endBlock,
            appointment.challengePeriod,
            appointment.id,
            appointment.jobId,
            appointment.data,
            appointment.refund,
            appointment.gas,
            appointment.mode,
            appointment.eventABI,
            appointment.eventArgs,
            appointment.postCondition,
            appointment.paymentHash
        );
    }

    public static toIAppointment(appointment: Appointment): IAppointment {
        return {
            contractAddress: appointment.contractAddress,
            customerAddress: appointment.customerAddress,
            startBlock: appointment.startBlock,
            endBlock: appointment.endBlock,
            challengePeriod: appointment.challengePeriod,
            id: appointment.id,
            jobId: appointment.jobId,
            data: appointment.data,
            refund: appointment.refund,
            gas: appointment.gas,
            mode: appointment.mode,
            eventABI: appointment.eventABI,
            eventArgs: appointment.eventArgs,
            postCondition: appointment.postCondition,
            paymentHash: appointment.paymentHash
        };
    }

    // TODO:173: the ids on this object are a mess - rename + sort them out
    public uniqueId() {
        return `${this.id}|${this.customerAddress}`;
    }
    public uniqueJobId() {
        return `${this.uniqueId()}|${this.jobId}`;
    }
    public formatLog(message: string): string {
        return `|${this.uniqueJobId()}| ${message}`;
    }
    // TODO:173: this should be run when we accept an appointment to make sure it doesnt throw
    public getEventFilter(): ethers.EventFilter {
        // first generate the interface from the abi
        console.log(this.eventABI);
        ethers.utils.from
        const iFace = new ethers.utils.Interface(this.eventABI);
        console.log(iFace);
        // name of the event
        // TODO:173: also make sure that this is the only, and it is event etc
        const name = iFace.abi[0].name;
        const inputs = iFace.abi[0].inputs;

        //TODO:173: need a way to encode nulls
        // TODO:173: at the moment we do it by specifying indexes of non null items as the first point
        const indexes: number[] = ethers.utils.defaultAbiCoder.decode(["uint256[]"], this.eventArgs);
        const namedInputs = inputs
            .map((input, index) => (indexes.includes(index) ? input : undefined))
            .filter(i => i !== undefined)
            .map(i => i!);
        const params: any[] = [
            ...ethers.utils.defaultAbiCoder.decode(["uint256[]"].concat(namedInputs.map(i => i.type)), this.eventArgs)
        ];

        const topics = iFace.events[name].encodeTopics(params);

        return {
            address: this.contractAddress,
            // TODO:173: this could be empty no?
            topics
        };
    }
    public solidityPacked() {
        return ethers.utils.solidityPack(
            [
                "address",
                "address",
                "uint",
                "uint",
                "uint",
                "uint",
                "uint",
                "bytes",
                "uint",
                "uint",
                "uint",
                "bytes",
                "bytes",
                "bytes",
                "bytes32"
            ],
            [
                this.contractAddress,
                this.customerAddress,
                this.startBlock,
                this.endBlock,
                this.challengePeriod,
                this.id,
                this.jobId,
                this.data,
                this.refund,
                this.gas,
                this.mode,
                this.eventABI,
                this.eventArgs,
                this.postCondition,
                this.paymentHash
            ]
        );
    }
    public asArray() {}
}

// /**
//  * Ethereum variant of IAppointment
//  */
// export interface IEthereumAppointment extends IAppointment {
//     getStateLocator(): string;
//     getContractAbi(): any;
//     getContractAddress(): string;
//     getEventFilter(): ethers.EventFilter;
//     getEventName(): string;
//     getStateIdentifier(): string;
//     getStateNonce(): number;
//     formatLog(message: string): string;
//     getResponseFunctionName(): string;
//     getResponseFunctionArgs(): any[];
//     getResponseData(): IEthereumResponseData;
//     getDBRepresentation(): any;
// }

// /**
//  * An appointment that has been accepted by PISA
//  */
// export abstract class EthereumAppointment implements IEthereumAppointment {
//     public readonly id: string;

//     constructor(readonly expiryPeriod: number, readonly type: ChannelType, startBlock: number, endBlock: number) {
//         this.id = uuid();
//         if (startBlock) this.mStartBlock = startBlock;
//         if (endBlock) this.mEndBlock = endBlock;
//     }

//     private mStartBlock: number;
//     public get startBlock() {
//         return this.mStartBlock;
//     }
//     private mEndBlock: number;
//     public get endBlock() {
//         return this.mEndBlock;
//     }
//     private mPassedInspection: boolean;
//     public get passedInspection() {
//         return this.mPassedInspection;
//     }
//     public passInspection(startBlock: number) {
//         this.mPassedInspection = true;
//         this.mStartBlock = startBlock;
//         this.mEndBlock = startBlock + this.expiryPeriod;
//     }
//     public formatLog(message: string): string {
//         return `|${this.getStateIdentifier()}| ${message}`;
//     }

//     /**
//      * A combination of the state locator and the nonce for this state update
//      */
//     public getStateIdentifier() {
//         return `${this.getStateLocator()}:${this.getStateNonce()}`;
//     }

//     /**
//      * The minimum unique information required to identify the on-chain location of this state update
//      */
//     public abstract getStateLocator(): string;
//     public abstract getContractAbi(): any;
//     public abstract getContractAddress(): string;
//     public abstract getEventFilter(): ethers.EventFilter;
//     public abstract getEventName(): string;
//     public abstract getStateNonce(): number;

//     /**
//      * The minimum unique information required form a response
//      */
//     public abstract getResponseFunctionName(): string;
//     public abstract getResponseFunctionArgs(): any[];

//     /**
//      * Returns the IEthereumResponseData object for this appointment
//      */
//     public getResponseData(): IEthereumResponseData {
//         return {
//             contractAddress: this.getContractAddress(),
//             contractAbi: this.getContractAbi(),
//             functionName: this.getResponseFunctionName(),
//             functionArgs: this.getResponseFunctionArgs(),
//             endBlock: this.endBlock
//         };
//     }

//     /**
//      * All the information we need to save in the db
//      */
//     public getDBRepresentation() {
//         return {
//             ...this,
//             startBlock: this.startBlock,
//             endBlock: this.endBlock
//         };
//     }
// }

/**
 * An appointment signed by PISA
 */
export class SignedAppointment {
    constructor(public readonly appointment: IAppointment, public readonly signature: string) {}
    public serialise() {
        const signedAppointment = {
            ...this.appointment,
            signature: this.signature
        };

        return JSON.stringify(signedAppointment);
    }
}

// /**
//  * Represents the necessary data for an on-chain response from Pisa on the Ethereum blockchain.
//  */
// export interface IEthereumResponseData {
//     contractAddress: string;
//     contractAbi: any;
//     functionName: string;
//     functionArgs: any[];
//     endBlock: number;
// }
