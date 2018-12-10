"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ethers_1 = require("ethers");
class PublicValidationError extends Error {
}
exports.PublicValidationError = PublicValidationError;
function parseAppointment(obj) {
    if (!obj)
        throw new PublicValidationError("Appointment not defined.");
    propertyExistsAndIsOfType("expiryPeriod", "number", obj);
    doesPropertyExist("stateUpdate", obj);
    isStateUpdate(obj["stateUpdate"]);
    return obj;
}
exports.parseAppointment = parseAppointment;
function isStateUpdate(obj) {
    if (!obj)
        throw new PublicValidationError("stateUpdate does not exist.");
    propertyExistsAndIsOfType("hashState", "string", obj);
    const hexLength = ethers_1.utils.hexDataLength(obj.hashState);
    if (hexLength !== 32) {
        throw new PublicValidationError(`Invalid bytes32: ${obj.hashState}`);
    }
    propertyExistsAndIsOfType("round", "number", obj);
    propertyExistsAndIsOfType("contractAddress", "string", obj);
    try {
        // is this a valid address?
        ethers_1.utils.getAddress(obj.contractAddress);
    }
    catch (doh) {
        throw new PublicValidationError(`${obj.contractAddress} is not a valid address.`);
    }
    doesPropertyExist("signatures", obj);
    isArrayOfStrings(obj["signatures"]);
}
function isArrayOfStrings(obj) {
    if (obj instanceof Array) {
        obj.forEach(function (item) {
            if (typeof item !== "string") {
                return false;
            }
        });
        return true;
    }
    return false;
}
function propertyExistsAndIsOfType(property, basicType, obj) {
    doesPropertyExist(property, obj);
    isPropertyOfType(property, basicType, obj);
}
function doesPropertyExist(property, obj) {
    if (typeof obj[property] === typeof undefined)
        throw new PublicValidationError(`${property} not defined.`);
}
function isPropertyOfType(property, basicType, obj) {
    if (typeof obj[property] !== basicType) {
        throw new PublicValidationError(`${property} is of type: ${typeof obj[property]} not ${basicType}.`);
    }
}
