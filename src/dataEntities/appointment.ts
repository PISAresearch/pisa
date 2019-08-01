import { ethers } from "ethers";
import appointmentRequestSchemaJson from "./appointmentRequestSchema.json";
import Ajv from "ajv";
import { PublicDataValidationError, PublicInspectionError } from "./errors";
import logger from "../logger";
import { BigNumber, bigNumberify } from "ethers/utils";
import { groupTuples } from "../utils/ethers";
const ajv = new Ajv();
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
     * How much to refund the customer by, in wei
     */
    readonly refund: string;

    /**
     * The amount of gas to use when calling the external contract with the provided data
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
     * The post-condition data to be passed to the dispute handler to verify whether
     * recouse is required
     */
    readonly postCondition: string;

    /**
     * the hash used for fair exchange of the appointment. The customer will be required to
     * reveal the pre-image of this to seek recourse, which will only be given to them upon payment
     */
    readonly paymentHash: string;
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
        public readonly postCondition: string,
        public readonly paymentHash: string
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
            refund: appointment.refund.toString(),
            gasLimit: appointment.gasLimit.toString(),
            mode: appointment.mode,
            eventABI: appointment.eventABI,
            eventArgs: appointment.eventArgs,
            postCondition: appointment.postCondition,
            paymentHash: appointment.paymentHash
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
            appointmentRequest.postCondition,
            appointmentRequest.paymentHash
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
            refund: appointment.refund.toString(),
            gasLimit: appointment.gasLimit.toString(),
            mode: appointment.mode,
            eventABI: appointment.eventABI,
            eventArgs: appointment.eventArgs,
            postCondition: appointment.postCondition,
            paymentHash: appointment.paymentHash
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

    static parseBigNumber(numberString: string, name: string) {
        try {
            const bigNumber = new BigNumber(numberString);
            if (bigNumber.lt(0)) throw new PublicDataValidationError(`${name} must be non negative.`);
        } catch (doh) {
            if (doh instanceof PublicDataValidationError) throw doh;
            logger.info(doh);
            throw new PublicDataValidationError(`${name} is not a number.`);
        }
    }

    /**
     * Parse an appointment and check property types.
     * @param obj
     */
    public static parse(obj: any) {
        const valid = appointmentRequestValidation(obj);
        if (!valid) {
            logger.info({ results: appointmentRequestValidation.errors }, "Schema error.");
            throw new PublicDataValidationError(appointmentRequestValidation.errors!.map(e => e.message).join("\n"));
        }
        const request = obj as IAppointmentRequest;
        Appointment.parseBigNumber(request.refund, "Refund");
        Appointment.parseBigNumber(request.gasLimit, "Gas limit");
        return Appointment.fromIAppointmentRequest(request);
    }

    /**
     * Validate property values on the appointment
     * @param obj
     */
    public validate() {
        if (this.paymentHash.toLowerCase() !== Appointment.FreeHash) throw new PublicDataValidationError("Invalid payment hash."); // prettier-ignore

        try {
            this.mEventFilter = this.parseEventArgs();
        } catch (doh) {
            if (doh instanceof PublicDataValidationError) throw doh;
            logger.error(doh);
            throw new PublicDataValidationError("Invalid event arguments for ABI.");
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
            throw new PublicDataValidationError("Incorrect first argument. First argument must be a uint8[] encoded array of the indexes of the event arguments to be filtered on.") // prettier-ignore
        }

        const maxIndex = indexes.reduce((a, b) => (a > b ? a : b), 0);
        if (maxIndex > inputs.length - 1)
            throw new PublicInspectionError(
                `Index ${maxIndex} greater than number of arguments in event. Arg length: ${inputs.length - 1}.`
            );

        const namedInputs = indexes.map(i => inputs[i]);

        // only indexed fields can be included atm
        namedInputs
            .filter(i => !i.indexed)
            .forEach(i => {
                throw new PublicDataValidationError(`Only indexed event parameters can be specified as event arguments.  ${i.name ? `Parameter: ${i.name}` : ""}. Specified paramed: ${indexes}`); // prettier-ignore
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
     * The ABI encoded tightly packed representation for this appointment
     */
    public solidityPacked() {
        return ethers.utils.solidityPack(
            ...groupTuples([
                ["address", this.contractAddress],
                ["address", this.customerAddress],
                ["uint", this.startBlock],
                ["uint", this.endBlock],
                ["uint", this.challengePeriod],
                ["uint", this.customerChosenId],
                ["uint", this.jobId],
                ["bytes", this.data],
                ["uint", this.refund],
                ["uint", this.gasLimit],
                ["uint", this.mode],
                ["bytes", ethers.utils.toUtf8Bytes(this.eventABI)], // eventAbi is in human readable form, so needs to be encoded for 'bytes'
                ["bytes", this.eventArgs],
                ["bytes", this.postCondition],
                ["bytes32", this.paymentHash]
            ])
        );
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
