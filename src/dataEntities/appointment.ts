import { ethers } from "ethers";
import appointmentRequestSchemaJson from "./appointmentRequestSchema.json";
import Ajv from "ajv";
import { PublicDataValidationError, PublicInspectionError } from "./errors";
import logger from "../logger";
import { BigNumber } from "ethers/utils";
import { groupTuples } from "../utils/ethers";
import { Logger } from "../logger";
import betterAjvErrors from "better-ajv-errors";
import { BlockCache, ReadOnlyBlockCache } from "../blockMonitor/index.js";
import { IBlockStub } from "./block.js";
const ajv = new Ajv({ jsonPointers: true, allErrors: true });
const appointmentRequestValidation = ajv.compile(appointmentRequestSchemaJson);

export enum AppointmentMode {
    Relay = 0
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
    readonly jobId: number;

    /**
     * The data to supply when calling the external address from inside the contract
     */
    readonly data: string;

    /**
     * How much to refund the customer by, in wei. Maximum can be 0.1 ether = 100000000000000000
     */
    readonly refund: string;

    /**
     * The amount of gas to use when calling the external contract with the provided data. Maximum is 6 million = 6000000.
     */
    readonly gasLimit: string;

    /**
     * A human readable (https://blog.ricmoo.com/human-readable-contract-abis-in-ethers-js-141902f4d917) event abi
     */
    readonly eventABI: string;

    /**
     * ABI encoded event arguments for the event
     */
    readonly eventArgs: string;

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
    readonly id: number;

    /**
     * An identifier for the dispute handler to be used in checking state during recourse
     */
    readonly mode: number;
}

export interface IAppointment extends IAppointmentBase {
    /**
     * an appointment id, supplied by the customer
     */
    readonly customerChosenId: number;

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
        public readonly customerChosenId: number,
        public readonly jobId: number,
        public readonly data: string,
        public readonly refund: BigNumber,
        public readonly gasLimit: BigNumber,
        public readonly mode: number,
        public readonly eventABI: string,
        public readonly eventArgs: string,
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
            appointment.jobId,
            appointment.data,
            new BigNumber(appointment.refund),
            new BigNumber(appointment.gasLimit),
            appointment.mode,
            appointment.eventABI,
            appointment.eventArgs,
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
            jobId: appointment.jobId,
            data: appointment.data,
            refund: appointment.refund.toHexString(),
            gasLimit: appointment.gasLimit.toHexString(),
            mode: appointment.mode,
            eventABI: appointment.eventABI,
            eventArgs: appointment.eventArgs,
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
            appointmentRequest.jobId,
            appointmentRequest.data,
            new BigNumber(appointmentRequest.refund),
            new BigNumber(appointmentRequest.gasLimit),
            appointmentRequest.mode,
            appointmentRequest.eventABI,
            appointmentRequest.eventArgs,
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
            jobId: appointment.jobId,
            data: appointment.data,
            refund: appointment.refund.toHexString(),
            gasLimit: appointment.gasLimit.toHexString(),
            mode: appointment.mode,
            eventABI: appointment.eventABI,
            eventArgs: appointment.eventArgs,
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
        Appointment.parseBigNumber(request.gasLimit, "Gas limit", log);
        return Appointment.fromIAppointmentRequest(request);
    }

    /**
     * Validate property values on the appointment
     * @param log Logger to be used in case of failures
     */
    public async validate(blockCache: ReadOnlyBlockCache<IBlockStub>, log: Logger = logger) {
        if (this.paymentHash.toLowerCase() !== Appointment.FreeHash) throw new PublicDataValidationError("Invalid payment hash."); // prettier-ignore

        // the start block must be close to the current block +/- 5
        const currentHead = blockCache.head.number;
        if(this.startBlock < (currentHead - 5)) throw new PublicDataValidationError(`Start block too low. Start block must be within 5 blocks of the current block ${currentHead}.`); // prettier-ignore
        if(this.startBlock > (currentHead + 5)) throw new PublicDataValidationError(`Start block too high. Start block must be within 5 blocks of the current block ${currentHead}.`); // prettier-ignore
        if((this.endBlock - this.startBlock) > 60000) throw new PublicDataValidationError(`Appointment duration too great. Maximum duration between start and block is 60000.`); // prettier-ignore

        try {
            this.mEventFilter = this.parseEventArgs();
        } catch (doh) {
            if (doh instanceof PublicDataValidationError) throw doh;
            log.error(doh);
            throw new PublicDataValidationError("Invalid event arguments for ABI.");
        }

        // check refund and gas limit are reasonable
        if (this.gasLimit.gt(6000000)) throw new PublicDataValidationError("Gas limit cannot be greater than 6000000.");
        if (this.refund.gt(ethers.utils.parseEther("0.1"))) throw new PublicDataValidationError("Refund cannot be greater than 0.1 ether."); // prettier-ignore

        // check the sig
        let encoded;
        try {
            encoded = this.encode();
        } catch (doh) {
            log.error(doh);
            throw new PublicDataValidationError("Invalid solidity type. An error has occurred ABI encoding a field. This may be due to incorrect bytes encoding, please ensure that all byte(s) fields are of the correct length and are prefixed with 0x."); //prettier-ignore
        }
        let recoveredAddress;
        try {
            recoveredAddress = ethers.utils.verifyMessage(ethers.utils.arrayify(encoded), this.customerSig);
        } catch (doh) {
            log.error(doh);
            throw new PublicDataValidationError("Invalid signature.");
        }
        if (this.customerAddress.toLowerCase() !== recoveredAddress.toLowerCase()) {
            throw new PublicDataValidationError(`Invalid signature - did not recover customer address ${this.customerAddress}.`);
        }
    }

    /**
     * A non-unique identifier for an appointment. Many appointments from the same customer
     * can have the same locator, but appointments with the same locator must have different job
     * ids.
     */
    public get locator() {
        return `${this.customerChosenId}|${this.customerAddress}`;
    }
    /**
     * A unique id for this appointment. Many appointments can have the same locator
     * but they must all have unique ids. Generated from concatenating the locator with
     * the job id. Appointments with the same locator can be replaced by incrementing the
     * job id.
     */
    public get id() {
        return `${this.locator}|${this.jobId}`;
    }

    public formatLog(message: string): string {
        return `|${this.id}| ${message}`;
    }

    /**
     * An event filter for this appointment. Created by combining the provided
     * eventABI and the eventArgs
     */
    public get eventFilter() {
        if (!this.mEventFilter) {
            this.mEventFilter = this.parseEventArgs();
        }
        return this.mEventFilter;
    }
    private mEventFilter: ethers.EventFilter;
    private parseEventArgs(): ethers.EventFilter {
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

        let indexes: number[];
        try {
            indexes = ethers.utils.defaultAbiCoder.decode(["uint8[]"], this.eventArgs)[0];
        } catch (doh) {
            logger.info(doh);
            throw new PublicDataValidationError("Invalid EventArgs. Incorrect first argument. First argument must be a uint8[] encoded array of the indexes of the event arguments to be filtered on.") // prettier-ignore
        }

        const maxIndex = indexes.reduce((a, b) => (a > b ? a : b), 0);
        if (maxIndex > inputs.length - 1)
            throw new PublicInspectionError(
                `Invalid EventArgs. Index ${maxIndex} greater than number of arguments in event. Arg length: ${inputs.length -
                    1}.`
            );

        const namedInputs = indexes.map(i => inputs[i]);

        // only indexed fields can be included atm
        namedInputs
            .filter(i => !i.indexed)
            .forEach(i => {
                throw new PublicDataValidationError(`Invalid EventArgs. Only indexed event parameters can be specified as event arguments.  ${i.name ? `Parameter: ${i.name}` : ""}. Specified paramed: ${indexes}`); // prettier-ignore
            });

        // decode the inputs that have been specified
        const decodedInputs = ethers.utils.defaultAbiCoder
            .decode(["uint8[]"].concat(namedInputs.map(i => i.type)), this.eventArgs)
            .slice(1);

        // add nulls for the topics we that wont be filtered upon
        let topicInput = inputs.map((input, index) => {
            const decodedIndex = indexes.indexOf(index);
            if (decodedIndex === -1) return null;
            else return decodedInputs[decodedIndex];
        });

        // map booleans to 0 or 1, the encodeTopics function doesnt seem to be able to handle booleans
        topicInput = topicInput.map(t => (t === true ? 1 : t === false ? 0 : t));

        // finally encode the topics using the abi
        const topics = eventInterface.events[name].encodeTopics(topicInput);
        return {
            address: this.contractAddress,
            topics
        };
    }

    /**
     * The ABI encoded representation for this appointment
     */
    public encode() {
        const appointmentInfo = ethers.utils.defaultAbiCoder.encode(
            ...groupTuples([
                ["uint", this.customerChosenId],
                ["uint", this.jobId],
                ["uint", this.startBlock],
                ["uint", this.endBlock],
                ["uint", this.challengePeriod],
                ["uint", this.refund],
                ["bytes32", this.paymentHash]
            ])
        );

        const contractInfo = ethers.utils.defaultAbiCoder.encode(
            ...groupTuples([
                ["address", this.contractAddress],
                ["address", this.customerAddress],
                ["uint", this.gasLimit],
                ["bytes", this.data]
            ])
        );

        const conditionInfo = ethers.utils.defaultAbiCoder.encode(
            ...groupTuples([
                ["bytes", ethers.utils.toUtf8Bytes(this.eventABI)],
                ["bytes", this.eventArgs],
                ["bytes", this.preCondition],
                ["bytes", this.postCondition],
                ["uint", this.mode]
            ])
        );

        const encodedAppointment = ethers.utils.defaultAbiCoder.encode(
            ...groupTuples([["bytes", appointmentInfo], ["bytes", contractInfo], ["bytes", conditionInfo]])
        )

        return ethers.utils.keccak256(encodedAppointment);
    }
}

/**
 * An appointment signed by PISA
 */
export class SignedAppointment {
    constructor(public readonly appointment: Appointment, public readonly signature: string) {}
    public serialise() {
        const signedAppointment: IAppointmentRequest & { signature: string } = {
            ...Appointment.toIAppointmentRequest(this.appointment),
            signature: this.signature
        };

        return JSON.stringify(signedAppointment);
    }
}
