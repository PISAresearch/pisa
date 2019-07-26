import { ethers } from "ethers";
import appointmentRequestSchemaJson from "./appointmentRequestSchema.json";
import Ajv from "ajv";
import { PublicDataValidationError } from "./errors";
import logger from "../logger";
import { BigNumber } from "ethers/utils";
const ajv = new Ajv();
const appoitmentRequestValidation = ajv.compile(appointmentRequestSchemaJson);

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

// TODO:173: check the types of these in JSON schema - and improve the type checking
// TODO:173: perhaps need big numbers

export interface IAppointment {
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
    readonly customerChosenId: number;

    // a counter that allows users to replace existing jobs
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

    // the hash used for fair exchange of the appointment. The customer will be required to
    // reveal the pre-image of this to seek recourse, which will only be given to them upon payment
    paymentHash: string;
}

export class AppointmentRequest {}

export class Appointment implements IAppointment {
    constructor(
        // the address of the external contract to which the data will be submitted
        public readonly contractAddress: string,
        public readonly customerAddress: string,
        public readonly startBlock: number,
        public readonly endBlock: number,
        public readonly challengePeriod: number,
        public readonly customerChosenId: number,
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
            appointment.customerChosenId,
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
            customerChosenId: appointment.customerChosenId,
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

    public static FreeHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("on-the-house"));

    public static validate(obj: any) {
        // TODO:173: this requires tests
        const valid = appoitmentRequestValidation(obj);
        if (!valid) throw new PublicDataValidationError(appoitmentRequestValidation.errors!.map(e => `${e.propertyName}:${e.message}`).join("\n")); // prettier-ignore

        const appointment = Appointment.fromIAppointment(obj as IAppointment);
        if (appointment.paymentHash !== Appointment.FreeHash) throw new PublicDataValidationError("Invalid payment hash."); // prettier-ignore

        try {
            appointment.getEventFilter();
        } catch (doh) {
            console.log(doh);
            logger.error(doh);
            throw new PublicDataValidationError("Invalid event arguments for ABI.");
        }

        return appointment;
    }

    public get locator() {
        return `${this.customerChosenId}|${this.customerAddress}`;
    }
    public get id() {
        return `${this.locator}|${this.jobId}`;
    }
    public formatLog(message: string): string {
        return `|${this.id}| ${message}`;
    }

    public get eventFilter() {
        if(!this.mEventFilter) {
            this.mEventFilter = this.getEventFilter();
        }
        return this.mEventFilter;
    }
    private mEventFilter: ethers.EventFilter;

    // TODO:173: this should be run when we accept an appointment to make sure it doesnt throw
    private getEventFilter(): ethers.EventFilter {
        // the abi is in human readable format, we can parse it with ethersjs
        // then check that it's of the right form before separating the name and inputs
        // to form topics

        const eventInterface = new ethers.utils.Interface([this.eventABI]);
        if (eventInterface.abi.length !== 1) throw new PublicDataValidationError("Invalid ABI. ABI must specify a single event."); // prettier-ignore
        const event = eventInterface.abi[0];

        if (event.type !== "event") throw new PublicDataValidationError("Invalid ABI. ABI must specify an event.");

        const name = eventInterface.abi[0].name;
        const inputs = eventInterface.abi[0].inputs;

        // we encode within the data which inputs we'll be filtering on
        // so the first thing encoded is an array of integers representing the
        // indexes of the arguments that will be used in the filter.
        // non specified indexes will be null
        // TODO:173: tests for this whole function
        const indexes: BigNumber[] = ethers.utils.defaultAbiCoder.decode(["uint256[]"], this.eventArgs)[0];
        const namedInputs = indexes.map(i => i.toNumber()).map(i => inputs[i]);
        const decodedInputs = ethers.utils.defaultAbiCoder
            .decode(["uint256[]"].concat(namedInputs.map(i => i.type)), this.eventArgs)
            .slice(1);

        const topics = eventInterface.events[name].encodeTopics(decodedInputs);
        return {
            address: this.contractAddress,
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
                this.customerChosenId,
                this.jobId,
                this.data,
                this.refund,
                this.gas,
                this.mode,
                ethers.utils.toUtf8Bytes(this.eventABI),
                this.eventArgs,
                this.postCondition,
                this.paymentHash
            ]
        );
    }
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
