import { utils } from "ethers";

export interface IAppointmentRequest {
    stateUpdate: IStateUpdate;
    expiryPeriod: number;
}

export interface IRaidenAppointmentRequest {
    stateUpdate: IRaidenStateUpdate;
    expiryPeriod: number;
}
// TODO: documentation in these classes
export interface IAppointment {
    stateUpdate: IStateUpdate;
    startTime: number;
    endTime: number;
    inspectionTime: number;
}

export interface IRaidenAppointment {
    stateUpdate: IRaidenStateUpdate;
    startTime: number;
    endTime: number;
    inspectionTime: number;
}

export interface IStateUpdate {
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

export function parseAppointment(obj: any) {
    if (!obj) throw new PublicValidationError("Appointment not defined.");
    propertyExistsAndIsOfType("expiryPeriod", "number", obj);
    doesPropertyExist("stateUpdate", obj);
    isStateUpdate(obj["stateUpdate"]);
    return obj as IAppointmentRequest;
}

export function parseRaidenAppointment(obj: any) {
    if (!obj) throw new PublicValidationError("Appointment not defined.");
    propertyExistsAndIsOfType("expiryPeriod", "number", obj);
    doesPropertyExist("stateUpdate", obj);
    isRaidenStateUpdate(obj["stateUpdate"]);
    return obj as IAppointmentRequest;
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

function isStateUpdate(obj: any) {
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
