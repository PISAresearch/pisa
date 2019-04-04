import { ChannelType } from "./channelType";
import { PublicDataValidationError } from "./errors";

export function checkAppointment(obj: any, type: ChannelType) {
    if (!obj) throw new PublicDataValidationError("Appointment not defined.");
    propertyExistsAndIsOfType("expiryPeriod", "number", obj);
    propertyExistsAndIsOfType("type", "string", obj);
    if (obj["type"] !== type) throw new PublicDataValidationError(`Appointment is of type ${obj["type"]}`);

    return obj;
}

export function isArrayOfStrings(obj: any) {
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

export function propertyExistsAndIsOfType(property: string, basicType: string, obj: any) {
    doesPropertyExist(property, obj);
    isPropertyOfType(property, basicType, obj);
}

export function doesPropertyExist(property: string, obj: any) {
    if (typeof obj[property] === typeof undefined) throw new PublicDataValidationError(`${property} not defined.`);
}

export function isPropertyOfType(property: string, basicType: string, obj: any) {
    if (typeof obj[property] !== basicType) {
        throw new PublicDataValidationError(`${property} is of type: ${typeof obj[property]} not ${basicType}.`);
    }
}
