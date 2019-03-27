import { utils, ethers } from "ethers";
import RaidenContracts from "./../integrations/raiden/raiden_data.json";
const tokenNetworkAbi = RaidenContracts.contracts.TokenNetwork.abi;
import { KitsuneTools } from "./../integrations/kitsune/tools";

export enum ChannelType {
    None = 0,
    Kitsune = 1,
    Raiden = 2
}

export interface IAppointmentRequest {
    expiryPeriod: number;
    type: ChannelType;
}

export abstract class AppointmentRequest implements IAppointmentRequest {
    constructor(public readonly type: ChannelType.Kitsune, public readonly expiryPeriod: number) {}

    static parse(obj: any) {
        // look for a type argument
        const type = obj["type"];
        switch (type) {
            case ChannelType.Kitsune:
                return parseKitsuneAppointment(obj);
            case ChannelType.Raiden:
                return parseRaidenAppointment(obj);
            default:
                throw new PublicValidationError(`Unknown appotiment request type ${type}.`);
        }
    }
}

export class KitsuneAppointmentRequest extends AppointmentRequest {
    constructor(public readonly stateUpdate: IKitsuneStateUpdate, type: ChannelType.Kitsune, expiryPeriod: number) {
        super(type, expiryPeriod);
    }
}

export class RaidenAppointmentRequest extends AppointmentRequest {
    constructor(public readonly stateUpdate: IRaidenStateUpdate, type: ChannelType.Kitsune, expiryPeriod: number) {
        super(type, expiryPeriod);
    }
}

// PISA: docs in here
export interface IAppointment {
    startTime: number;
    endTime: number;
    inspectionTime: number;
    type: ChannelType;
    getContractAddress(): string;
    getChannelIdentifier(): string;
    getEventFilter(contract: ethers.Contract): ethers.EventFilter;
    getEventName(): string;
    getContractAbi(): any;
    getSubmitStateFunction(): (contract: ethers.Contract, ...args: any[]) => Promise<void>;
}

abstract class AppointmentBase implements IAppointment {
    constructor(
        readonly startTime: number,
        readonly endTime: number,
        readonly inspectionTime: number,
        readonly type: ChannelType
    ) {}
    abstract getContractAddress();
    abstract getChannelIdentifier();
    abstract getEventFilter(contract: ethers.Contract);
    abstract getEventName();
    abstract getContractAbi(): any;
    abstract getSubmitStateFunction(): (contract: ethers.Contract, ...args: any[]) => Promise<void>;
}

// PISA: documentation in these classes
export class KitsuneAppointment extends AppointmentBase {
    constructor(readonly stateUpdate: IKitsuneStateUpdate, startTime: number, endTime: number, inspectionTime: number) {
        super(startTime, endTime, inspectionTime, ChannelType.Kitsune);
    }

    // PISA: still used?
    getContractAddress() {
        return this.stateUpdate.contractAddress;
    }

    getChannelIdentifier() {
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

    getSubmitStateFunction() {
        return async (contract: ethers.Contract, ...args: any[]) => await KitsuneTools.respond(contract, this, ...args);
    }
}

export class RaidenAppointment extends AppointmentBase {
    constructor(readonly stateUpdate: IRaidenStateUpdate, startTime: number, endTime: number, inspectionTime: number) {
        super(startTime, endTime, inspectionTime, ChannelType.Raiden);
    }

    getContractAddress() {
        return this.stateUpdate.token_network_identifier;
    }

    getChannelIdentifier() {
        return `${this.stateUpdate.token_network_identifier}:${this.stateUpdate.channel_identifier}`;
    }

    getEventFilter(contract: ethers.Contract) {
        return contract.filters.ChannelClosed(
            this.stateUpdate.channel_identifier,
            this.stateUpdate.closing_participant,
            null
        );
    }

    getEventName() {
        return `ChannelClosed - ${this.stateUpdate.channel_identifier} - ${this.stateUpdate.closing_participant} - ${
            this.stateUpdate.nonce
        }`;
    }

    getContractAbi() {
        return tokenNetworkAbi;
    }

    getSubmitStateFunction() {
        return async (contract: ethers.Contract, ...args: any[]) =>
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

export interface IKitsuneStateUpdate {
    signatures: string[];
    hashState: string;
    round: number;
    contractAddress: string;
}

export interface IRaidenStateUpdate {
    channel_identifier: number;
    closing_participant: string;
    non_closing_participant: string;
    balance_hash: string;
    nonce: number;
    additional_hash: string;
    closing_signature: string;
    non_closing_signature: string;
    chain_id: number;
    token_network_identifier: string;
}

export class PublicValidationError extends Error {}

// PISA: normalise below

export function parseKitsuneAppointment(obj: any) {
    if (!obj) throw new PublicValidationError("Appointment not defined.");
    propertyExistsAndIsOfType("expiryPeriod", "number", obj);
    doesPropertyExist("stateUpdate", obj);
    isKitsuneStateUpdate(obj["stateUpdate"]);

    propertyExistsAndIsOfType("type", "number", obj);
    if (obj["type"] !== ChannelType.Kitsune) throw new PublicValidationError(`Appointment is of type ${obj["type"]}`);

    return new KitsuneAppointmentRequest(obj["stateUpdate"], obj["type"], obj["expiryPeriod"]);
}

export function parseRaidenAppointment(obj: any) {
    if (!obj) throw new PublicValidationError("Appointment not defined.");
    propertyExistsAndIsOfType("expiryPeriod", "number", obj);
    doesPropertyExist("stateUpdate", obj);
    isRaidenStateUpdate(obj["stateUpdate"]);

    propertyExistsAndIsOfType("type", "number", obj);
    if (obj["type"] !== ChannelType.Raiden) throw new PublicValidationError(`Appointment is of type ${obj["type"]}`);

    return new RaidenAppointmentRequest(obj["stateUpdate"], obj["type"], obj["expiryPeriod"]);
}

function isRaidenStateUpdate(obj: any) {
    if (!obj) throw new PublicValidationError("stateUpdate does not exist.");
    propertyExistsAndIsOfType("additional_hash", "string", obj);
    const hexLength = utils.hexDataLength(obj.additional_hash);
    if (hexLength !== 32) {
        throw new PublicValidationError(`Invalid bytes32: ${obj.additional_hash}`);
    }

    propertyExistsAndIsOfType("balance_hash", "string", obj);
    const balanceHexLength = utils.hexDataLength(obj.balance_hash);
    if (balanceHexLength !== 32) {
        throw new PublicValidationError(`Invalid bytes32: ${obj.balanceHexLength}`);
    }

    propertyExistsAndIsOfType("channel_identifier", "number", obj);

    propertyExistsAndIsOfType("closing_participant", "string", obj);
    try {
        // is this a valid address?
        utils.getAddress(obj.closing_participant);
    } catch (doh) {
        throw new PublicValidationError(`${obj.closing_participant} is not a valid address.`);
    }

    propertyExistsAndIsOfType("closing_signature", "string", obj);

    propertyExistsAndIsOfType("non_closing_participant", "string", obj);
    try {
        // is this a valid address?
        utils.getAddress(obj.non_closing_participant);
    } catch (doh) {
        throw new PublicValidationError(`${obj.non_closing_participant} is not a valid address.`);
    }

    propertyExistsAndIsOfType("non_closing_signature", "string", obj);

    propertyExistsAndIsOfType("nonce", "number", obj);
    propertyExistsAndIsOfType("chain_id", "number", obj);

    propertyExistsAndIsOfType("token_network_identifier", "string", obj);
    try {
        // is this a valid address?
        utils.getAddress(obj.token_network_identifier);
    } catch (doh) {
        throw new PublicValidationError(`${obj.token_network_identifier} is not a valid address.`);
    }
}

function isKitsuneStateUpdate(obj: any) {
    if (!obj) throw new PublicValidationError("stateUpdate does not exist.");
    propertyExistsAndIsOfType("hashState", "string", obj);
    const hexLength = utils.hexDataLength(obj.hashState);
    if (hexLength !== 32) {
        throw new PublicValidationError(`Invalid bytes32: ${obj.hashState}`);
    }

    propertyExistsAndIsOfType("round", "number", obj);
    propertyExistsAndIsOfType("contractAddress", "string", obj);
    try {
        // is this a valid address?
        utils.getAddress(obj.contractAddress);
    } catch (doh) {
        throw new PublicValidationError(`${obj.contractAddress} is not a valid address.`);
    }

    doesPropertyExist("signatures", obj);
    isArrayOfStrings(obj["signatures"]);
}

function isArrayOfStrings(obj: any) {
    if (obj instanceof Array) {
        obj.forEach(function(item) {
            if (typeof item !== "string") {
                return false;
            }
        });
        return true;
    }
    return false;
}

function propertyExistsAndIsOfType(property: string, basicType: string, obj: any) {
    doesPropertyExist(property, obj);
    isPropertyOfType(property, basicType, obj);
}

function doesPropertyExist(property: string, obj: any) {
    if (typeof obj[property] === typeof undefined) throw new PublicValidationError(`${property} not defined.`);
}

function isPropertyOfType(property: string, basicType: string, obj: any) {
    if (typeof obj[property] !== basicType) {
        throw new PublicValidationError(`${property} is of type: ${typeof obj[property]} not ${basicType}.`);
    }
}
