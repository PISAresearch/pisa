import { utils } from "ethers";
import { ChannelType } from "./channelType";
import { PublicDataValidationError } from "./errors";
export function checkKitsuneAppointment(obj: any) {
    if (!obj) throw new PublicDataValidationError("Appointment not defined.");
    propertyExistsAndIsOfType("expiryPeriod", "number", obj);
    doesPropertyExist("stateUpdate", obj);
    isKitsuneStateUpdate(obj["stateUpdate"]);

    propertyExistsAndIsOfType("type", "string", obj);
    if (obj["type"] !== ChannelType.Kitsune)
        throw new PublicDataValidationError(`Appointment is of type ${obj["type"]}`);

    return obj;
}

export function checkRaidenAppointment(obj: any) {
    if (!obj) throw new PublicDataValidationError("Appointment not defined.");
    propertyExistsAndIsOfType("expiryPeriod", "number", obj);
    doesPropertyExist("stateUpdate", obj);
    isRaidenStateUpdate(obj["stateUpdate"]);

    propertyExistsAndIsOfType("type", "string", obj);
    if (obj["type"] !== ChannelType.Raiden)
        throw new PublicDataValidationError(`Appointment is of type ${obj["type"]}`);

    return obj;
}

function isRaidenStateUpdate(obj: any) {
    if (!obj) throw new PublicDataValidationError("stateUpdate does not exist.");
    propertyExistsAndIsOfType("additional_hash", "string", obj);
    const hexLength = utils.hexDataLength(obj.additional_hash);
    if (hexLength !== 32) {
        throw new PublicDataValidationError(`Invalid bytes32: ${obj.additional_hash}`);
    }

    propertyExistsAndIsOfType("balance_hash", "string", obj);
    const balanceHexLength = utils.hexDataLength(obj.balance_hash);
    if (balanceHexLength !== 32) {
        throw new PublicDataValidationError(`Invalid bytes32: ${obj.balanceHexLength}`);
    }

    propertyExistsAndIsOfType("channel_identifier", "number", obj);

    propertyExistsAndIsOfType("closing_participant", "string", obj);
    try {
        // is this a valid address?
        utils.getAddress(obj.closing_participant);
    } catch (doh) {
        throw new PublicDataValidationError(`${obj.closing_participant} is not a valid address.`);
    }

    propertyExistsAndIsOfType("closing_signature", "string", obj);

    propertyExistsAndIsOfType("non_closing_participant", "string", obj);
    try {
        // is this a valid address?
        utils.getAddress(obj.non_closing_participant);
    } catch (doh) {
        throw new PublicDataValidationError(`${obj.non_closing_participant} is not a valid address.`);
    }

    propertyExistsAndIsOfType("non_closing_signature", "string", obj);

    propertyExistsAndIsOfType("nonce", "number", obj);
    propertyExistsAndIsOfType("chain_id", "number", obj);

    propertyExistsAndIsOfType("token_network_identifier", "string", obj);
    try {
        // is this a valid address?
        utils.getAddress(obj.token_network_identifier);
    } catch (doh) {
        throw new PublicDataValidationError(`${obj.token_network_identifier} is not a valid address.`);
    }
}

function isKitsuneStateUpdate(obj: any) {
    if (!obj) throw new PublicDataValidationError("stateUpdate does not exist.");
    propertyExistsAndIsOfType("hashState", "string", obj);
    const hexLength = utils.hexDataLength(obj.hashState);
    if (hexLength !== 32) {
        throw new PublicDataValidationError(`Invalid bytes32: ${obj.hashState}`);
    }

    propertyExistsAndIsOfType("round", "number", obj);
    propertyExistsAndIsOfType("contractAddress", "string", obj);
    try {
        // is this a valid address?
        utils.getAddress(obj.contractAddress);
    } catch (doh) {
        throw new PublicDataValidationError(`${obj.contractAddress} is not a valid address.`);
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
    if (typeof obj[property] === typeof undefined) throw new PublicDataValidationError(`${property} not defined.`);
}

function isPropertyOfType(property: string, basicType: string, obj: any) {
    if (typeof obj[property] !== basicType) {
        throw new PublicDataValidationError(`${property} is of type: ${typeof obj[property]} not ${basicType}.`);
    }
}
