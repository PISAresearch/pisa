import { ethers } from "ethers";
import appointmentRequestSchemaJson from "../public/appointmentRequestSchema.json";
import Ajv from "ajv";
import { PublicDataValidationError, PublicInspectionError, ArgumentError } from "./errors";
import logger from "../logger";
import { BigNumber } from "ethers/utils";
import { Logger } from "../logger";
import betterAjvErrors from "better-ajv-errors";
import { ReadOnlyBlockCache } from "../blockMonitor/index.js";
import { IBlockStub } from "./block.js";
import * as PisaContract from "../../sol/build/contracts/PISAHash.json";
import { encodeTopicsForPisa } from "../utils/ethers";
const ABI = PisaContract.abi;
const ajv = new Ajv({ jsonPointers: true, allErrors: true });
const appointmentRequestValidation = ajv.compile(appointmentRequestSchemaJson);

export enum AppointmentMode {
    Relay = 0,
    EventTriggered = 1
}

export interface IAppointmentBase {
    /**
     * The address of the external contract to which the data will be submitted
     */
    readonly contractAddress: string;

    /**
     * The address of the customer hiring PISA
     */
    readonly customerAddress: string;

    /**
     * The block at which the appointment starts
     */
    readonly startBlock: number;

    /**
     * The block at which the appointment ends
     */
    readonly endBlock: number;

    /**
     * if the trigger event is noticed, then this is the number of blocks which
     * PISA has to respond
     */
    readonly challengePeriod: number;

    /**
     * A counter that allows users to replace existing jobs
     */
    readonly nonce: number;

    /**
     * The data to supply when calling the external address from inside the contract
     */
    readonly data: string;

    /**
     * How much to refund the customer by, in wei. Currently set to 0.
     */
    readonly refund: string;

    /**
     * The amount of gas to use when calling the external contract with the provided data. Maximum is 2 million = 2000000.
     */
    readonly gasLimit: number;

    /**
     * The address to watch for emitted events
     */
    readonly eventAddress: string;

    /**
     * Encoded topics for this appointment's trigger event
     */
    readonly topics: (string | null)[];

    /**
     * The pre-condition that must be satisfied before PISA can respond
     */
    readonly preCondition: string;

    /**
     * The post-condition data to be passed to the dispute handler to verify whether
     * recouse is required
     */
    readonly postCondition: string;

    /**
     * the hash used for fair exchange of the appointment. The customer will be required to
     * reveal the pre-image of this to seek recourse, which will only be given to them upon payment
     */
    readonly paymentHash: string;

    /**
     * The customers signature for this appointment
     */
    readonly customerSig: string;
}

export interface IAppointmentRequest extends IAppointmentBase {
    /**
     * an appointment id, supplied by the customer
     */
    readonly id: string;

    /**
     * An identifier for the dispute handler to be used in checking state during recourse
     */
    readonly mode: number;
}

export interface IAppointment extends IAppointmentBase {
    /**
     * an appointment id, supplied by the customer
     */
    readonly customerChosenId: string;

    /**
     * An identifier for the dispute handler to be used in checking state during recourse
     */
    readonly mode: AppointmentMode;
}

/**
 * A customer appointment, detailing what event to be watched for and data to submit.
 */
export class Appointment {
    constructor(
        public readonly contractAddress: string,
        public readonly customerAddress: string,
        public readonly startBlock: number,
        public readonly endBlock: number,
        public readonly challengePeriod: number,
        public readonly customerChosenId: string,
        public readonly nonce: number,
        public readonly data: string,
        public readonly refund: BigNumber,
        public readonly gasLimit: number,
        public readonly mode: number,
        public readonly eventAddress: string,
        public readonly topics: (string | null)[],
        public readonly preCondition: string,
        public readonly postCondition: string,
        public readonly paymentHash: string,
        public readonly customerSig: string
    ) {}

    public static fromIAppointment(appointment: IAppointment): Appointment {
        return new Appointment(
            appointment.contractAddress,
            appointment.customerAddress,
            appointment.startBlock,
            appointment.endBlock,
            appointment.challengePeriod,
            appointment.customerChosenId,
            appointment.nonce,
            appointment.data,
            new BigNumber(appointment.refund),
            appointment.gasLimit,
            appointment.mode,
            appointment.eventAddress,
            appointment.topics,
            appointment.preCondition,
            appointment.postCondition,
            appointment.paymentHash,
            appointment.customerSig
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
            nonce: appointment.nonce,
            data: appointment.data,
            refund: appointment.refund.toHexString(),
            gasLimit: appointment.gasLimit,
            mode: appointment.mode,
            eventAddress: appointment.eventAddress,
            topics: appointment.topics,
            preCondition: appointment.preCondition,
            postCondition: appointment.postCondition,
            paymentHash: appointment.paymentHash,
            customerSig: appointment.customerSig
        };
    }

    public static fromIAppointmentRequest(appointmentRequest: IAppointmentRequest): Appointment {
        return new Appointment(
            appointmentRequest.contractAddress,
            appointmentRequest.customerAddress,
            appointmentRequest.startBlock,
            appointmentRequest.endBlock,
            appointmentRequest.challengePeriod,
            appointmentRequest.id,
            appointmentRequest.nonce,
            appointmentRequest.data,
            new BigNumber(appointmentRequest.refund),
            appointmentRequest.gasLimit,
            appointmentRequest.mode,
            appointmentRequest.eventAddress,
            appointmentRequest.topics,
            appointmentRequest.preCondition,
            appointmentRequest.postCondition,
            appointmentRequest.paymentHash,
            appointmentRequest.customerSig
        );
    }

    public static toIAppointmentRequest(appointment: Appointment): IAppointmentRequest {
        return {
            contractAddress: appointment.contractAddress,
            customerAddress: appointment.customerAddress,
            startBlock: appointment.startBlock,
            endBlock: appointment.endBlock,
            challengePeriod: appointment.challengePeriod,
            id: appointment.customerChosenId,
            nonce: appointment.nonce,
            data: appointment.data,
            refund: appointment.refund.toHexString(),
            gasLimit: appointment.gasLimit,
            mode: appointment.mode,
            eventAddress: appointment.eventAddress,
            topics: appointment.topics,
            preCondition: appointment.preCondition,
            postCondition: appointment.postCondition,
            paymentHash: appointment.paymentHash,
            customerSig: appointment.customerSig
        };
    }

    /**
     * Currently we dont charge access to the API. But when we payment will be proved
     * by being able to reveal the pre-image of the payment hash. Even though the API is
     * free we'll use payment hash now to keep the same structure of appointment as we'll
     * use when we add payment. For now clients can gain access to the API by putting the
     * hash of 'on-the-house' as the payment hash. Hash is lower case.
     */
    public static FreeHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("on-the-house")).toLowerCase();

    static parseBigNumber(numberString: string, name: string, log: Logger) {
        try {
            const bigNumber = new BigNumber(numberString);
            if (bigNumber.lt(0)) throw new PublicDataValidationError(`${name} must be non negative.`);
        } catch (doh) {
            if (doh instanceof PublicDataValidationError) throw doh;
            log.info(doh);
            throw new PublicDataValidationError(`${name} is not a number.`);
        }
    }

    /**
     * Parse an appointment and check property types.
     * @param obj
     * @param log Logger to be used in case of failures
     */
    public static parse(obj: any, log: Logger = logger) {
        const valid = appointmentRequestValidation(obj);

        if (!valid) {
            const betterErrors = betterAjvErrors(
                appointmentRequestSchemaJson,
                obj,
                appointmentRequestValidation.errors,
                { format: "js" }
            );
            if (betterErrors) {
                log.info({ results: betterErrors }, "Schema error.");
                throw new PublicDataValidationError(betterErrors.map(e => e.error).join("\n"));
            }
        }
        const request = obj as IAppointmentRequest;
        Appointment.parseBigNumber(request.refund, "Refund", log);
        const refund = new BigNumber(request.refund);
        if (!refund.eq(0)) throw new PublicDataValidationError("Refund must be set to 0");
        return Appointment.fromIAppointmentRequest(request);
    }

    /**
     * The maximum amount we'll allow clients to cover themselves against forks.
     */
    private static readonly FORK_LIMIT = 20;

    /**
     * The maximum amount we'll allow clients to cover themselves against not being up to
     * date with the same of head as ours.
     */
    private static readonly SYNCHRONISATION_LIMIT = 3;

    /**
     * Validate property values on the appointment
     * @param log Logger to be used in case of failures
     */
    public async validate(
        blockCache: ReadOnlyBlockCache<IBlockStub>,
        pisaContractAddress: string,
        log: Logger = logger
    ) {
        if (this.paymentHash.toLowerCase() !== Appointment.FreeHash) throw new PublicDataValidationError("Invalid payment hash."); // prettier-ignore

        const currentHead = blockCache.head.number;
        // An attacker could fork the network causing a crucial event to occur
        // before the appointment starts. Therefore a customer would want to hire pisa
        // a small amount in the past to reduce this risk. There is also a margin of error
        // between clients - we may be at different block heights
        if(this.startBlock < (currentHead - Appointment.FORK_LIMIT - Appointment.SYNCHRONISATION_LIMIT)) throw new PublicDataValidationError(`Start block too low. Start block must be within ${Appointment.FORK_LIMIT + Appointment.SYNCHRONISATION_LIMIT} blocks of the current block ${currentHead}.`); // prettier-ignore
        if(this.startBlock > (currentHead + Appointment.SYNCHRONISATION_LIMIT)) throw new PublicDataValidationError(`Start block too high. Start block must be within ${Appointment.SYNCHRONISATION_LIMIT} blocks of the current block ${currentHead}.`); // prettier-ignore
        if((this.endBlock - this.startBlock) > 60000) throw new PublicDataValidationError(`Appointment duration too great. Maximum duration between start and end block is 60000.`); // prettier-ignore
        if((this.endBlock - this.startBlock) < 100) throw new PublicDataValidationError(`Appointment duration too small. Minimum duration between start and end block is 100.`); // prettier-ignore

        if (this.preCondition !== "0x") throw new PublicDataValidationError("Pre-condition currently not supported. Please set to '0x'"); //prettier-ignore
        if (this.postCondition !== "0x") throw new PublicDataValidationError("Post-condition currently not supported. Please set to '0x'"); //prettier-ignore
        
        if (this.mode === AppointmentMode.EventTriggered) {
            // we test eventAddress and each non-null topic by attempting to encode them
            try {
                ethers.utils.getAddress(this.eventAddress);
            } catch (doh) {
                logger.info(doh);
                throw new PublicDataValidationError(`Invalid eventAddress: ${this.eventAddress}`); // prettier-ignore
            }

            if (this.topics.length > 4) throw new PublicDataValidationError(`The topics array must have at most 4 elements; ${this.topics.length} were given`); //prettier-ignore
            for (const [idx, topic] of this.topics.entries()) {
                if (topic != null) {
                    if (topic.length !== 2+2*32 || !ethers.utils.isHexString(topic)) throw new PublicDataValidationError(`The topic with index ${idx} is invalid: ${topic}.`); // prettier-ignore
                }
            }
        } else if (this.mode === AppointmentMode.Relay){
            if(this.eventAddress !== "0x0000000000000000000000000000000000000000") throw new PublicDataValidationError("Event address must be set to \"0x0000000000000000000000000000000000000000\" for relay transactions."); //prettier-ignore
            if(this.topics.length !== 0) throw new PublicDataValidationError("Event topics must be set to [] for relay transactions."); //prettier-ignore
        } else {
            throw new PublicDataValidationError("Mode must be set to 0 or 1. 0 for relay appointments, 1 for event triggered appointments."); //prettier-ignore
        }

        // check refund and gas limit are reasonable
        if (this.refund.gt(ethers.utils.parseEther("0.1"))) throw new PublicDataValidationError("Refund cannot be greater than 0.1 ether."); // prettier-ignore

        // check the sig
        let encoded;
        try {
            // try to encode the solidity type
            encoded = this.encodeForSig(pisaContractAddress);
        } catch (doh) {
            log.error(doh);
            throw new PublicDataValidationError("Invalid solidity type. An error has occurred ABI encoding a field. This may be due to incorrect bytes encoding, please ensure that all byte(s) fields are of the correct length and are prefixed with 0x."); //prettier-ignore
        }
        let recoveredAddress;
        try {
            const hashForSig = ethers.utils.keccak256(encoded);
            recoveredAddress = ethers.utils.verifyMessage(ethers.utils.arrayify(hashForSig), this.customerSig);
        } catch (doh) {
            log.error(doh);
            throw new PublicDataValidationError("Invalid signature.");
        }
        if (this.customerAddress.toLowerCase() !== recoveredAddress.toLowerCase()) {
            throw new PublicDataValidationError(
                `Invalid signature - did not recover customer address ${this.customerAddress}.`
            );
        }
    }

    /**
     * A non-unique identifier for an appointment. Many appointments from the same customer
     * can have the same locator, but appointments with the same locator must have different job
     * ids.
     */
    public get locator() {
        return `${this.customerAddress}|${this.customerChosenId}`;
    }
    /**
     * A unique id for this appointment. Many appointments can have the same locator
     * but they must all have unique ids. Generated from concatenating the locator with
     * the nonce. Appointments with the same locator can be replaced by incrementing the
     * nonce.
     */
    public get id() {
        return `${this.locator}|${this.nonce}`;
    }

    public formatLog(message: string): string {
        return `|${this.id}| ${message}`;
    }

    /**
     * An event filter for this appointment. Created by combining the provided
     * event address and topics
     */
    public get eventFilter(): ethers.EventFilter {
        return {
            address: this.eventAddress,
            topics: this.topics as string[] // ethers.js declares the type as string[] despite allowing null valuess
        };
    }


    /**
     * Order the properties of the appointment prior to encoding as a tuple
     */
    public orderForEncoding() {
        return [
            this.contractAddress,
            this.customerAddress,
            this.startBlock,
            this.endBlock,
            this.challengePeriod,
            this.customerChosenId,
            this.nonce,
            this.data,
            this.refund,
            this.gasLimit,
            this.mode,
            this.eventAddress,
            encodeTopicsForPisa(this.topics),
            this.preCondition,
            this.postCondition,
            this.paymentHash
        ];
    }

    public static EncodingTupleDefinition =
        "tuple(address,address,uint,uint,uint,bytes32,uint,bytes,uint,uint,uint,address,bytes,bytes,bytes,bytes32)";

    /**
     * Encode this appointment as a function call to response
     * @param appointment
     */
    public encodeForResponse() {
        const sig = this.customerSig;
        const iFace = new ethers.utils.Interface(ABI);
        return iFace.functions.respond.encode([this.orderForEncoding(), sig]);
    }

    /**
     * Encode this appointment ready for signing
     * @param pisaContractAddress The appointment is combined with the address of the pisa contract before signature
     */
    public encodeForSig(pisaContractAddress: string) {
        return ethers.utils.defaultAbiCoder.encode(
            [Appointment.EncodingTupleDefinition, "address"],
            [this.orderForEncoding(), pisaContractAddress]
        );
    }
}

/**
 * An appointment signed by PISA
 */
export class SignedAppointment {
    constructor(
        public readonly appointment: Appointment,
        public readonly signerAddress: string,
        public readonly signature: string
    ) {}
    public serialise() {
        const signedAppointment: {
            appointment: IAppointmentRequest;
            watcherSignature: string;
            watcherAddress: string;
        } = {
            appointment: Appointment.toIAppointmentRequest(this.appointment),
            watcherSignature: this.signature,
            watcherAddress: this.signerAddress
        };

        return JSON.stringify(signedAppointment);
    }
}
