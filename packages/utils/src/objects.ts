import { BigNumber } from "ethers/utils";
import { UnreachableCaseError } from "@pisa-research/errors";

export type Primitive = boolean | number | string | null | undefined;

export type AnyObject =
    | Primitive
    | Array<AnyObject>
    | PlainObject;

export type PlainObject = {
    [key: string]: AnyObject;
};


enum SerialisableType {
    BigNumber = "bn"
}

type SerialisedBigNumber = {
    _type: SerialisableType.BigNumber,
    value: string
};

export interface Serialisable {
    serialise(): TypedPlainObject;
}

// union of all the possible serialised types
export type TypedPlainObject = SerialisedBigNumber;

class SerialisableBigNumber extends BigNumber {
    public serialise(): TypedPlainObject {
        return {
            _type: SerialisableType.BigNumber,
            value: this.toHexString()
        };
    }

    public static deserialise(obj: SerialisedBigNumber): SerialisableBigNumber {
        return new SerialisableBigNumber(obj.value);
    }
}

type AnyObjectOrSerialisable =
    | AnyObject
    | Serialisable
    | Array<AnyObjectOrSerialisable>
    | PlainObjectOrSerialisable;

export type PlainObjectOrSerialisable = {
    [key: string]: AnyObjectOrSerialisable;
};


function isPrimitive(value: any): value is Primitive {
    return (typeof value !== "object" && typeof value !== "function") || value == null;
}

function isSerialisable(obj: any): obj is Serialisable {
    return obj.serialise && obj.serialise instanceof Function;
}

function isSerialisedPlainObject(obj: PlainObject): obj is TypedPlainObject {
    return "_type" in Object.keys(obj);
}


export class PlainObjectSerialiser {
    constructor() {}

    public serialise(obj: AnyObjectOrSerialisable): AnyObject {
        if (isPrimitive(obj)) {
            return obj;
        } else if (Array.isArray(obj)) {
            return (obj as AnyObjectOrSerialisable[]).map(item => this.serialise(item));
        } else if (isSerialisable(obj)) {
            return obj.serialise();
        } else {
            const result: PlainObject = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = this.serialise(value);
            }
            return result;
        }
    }
    
    public deserialise<T>(obj: AnyObject): T {
        if (isPrimitive(obj)) {
            return (obj as unknown) as T;
        } else if (Array.isArray(obj)) {
            return obj.map(item => this.deserialise(item)) as unknown as T;
        } else if (isSerialisedPlainObject(obj)) {
            const type = obj._type;
            switch (type) {
                case SerialisableType.BigNumber:
                    return SerialisableBigNumber.deserialise(obj) as unknown as T;
                default:
                    throw new UnreachableCaseError(type, "Unexpected type while deserialising.");
            }
        } else {
            // generic plain object
            const result: {[key: string]: any} = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = this.deserialise(value);
            }
            return result as T;
        }
    }
}
