import { BigNumber } from "ethers/utils";
import { ApplicationError } from "@pisa-research/errors";

export type Primitive = boolean | number | string | null | undefined;

export type AnyObject =
    | Primitive
    | Array<AnyObject>
    | PlainObject;

export type PlainObject = {
    [key: string]: AnyObject;
};

export type DbObject = boolean | number | string | AnyObject[] | PlainObject;

// union of all the possible serialised types
export interface TypedPlainObject extends PlainObject {
    _type: string;
}

type SerialisedBigNumber = TypedPlainObject & {
    value: string
};

export interface Serialisable {
    serialise(): TypedPlainObject;
}

export class SerialisableBigNumber extends BigNumber implements Serialisable {
    public static TYPE = "bn";
    public serialise(): SerialisedBigNumber {
        return {
            _type: SerialisableBigNumber.TYPE,
            value: this.toHexString()
        };
    }

    public static deserialise(obj: SerialisedBigNumber): SerialisableBigNumber {
        return new SerialisableBigNumber(obj.value);
    }
}

type DbObjectOrSerialisable =
    | DbObject
    | Serialisable
    | AnyObjectOrSerialisable[]
    | PlainObjectOrSerialisable;

type AnyObjectOrSerialisable =
    | AnyObject
    | Serialisable
    | AnyObjectOrSerialisable[]
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
    constructor(public readonly deserialisers: {[type: string]: (obj: TypedPlainObject) => Serialisable}) { }

    // Like serialise, but also allows null or undefined
    private serialiseAny(obj: AnyObjectOrSerialisable): null | undefined | DbObject {
        if (obj === null || obj == undefined) return obj;
        else return this.serialise(obj);
    }

    public serialise(obj: DbObjectOrSerialisable): DbObject {
        if (isPrimitive(obj)) {
            return obj;
        } else if (Array.isArray(obj)) {
            return (obj as AnyObjectOrSerialisable[]).map(item => this.serialiseAny(item));
        } else if (isSerialisable(obj)) {
            return obj.serialise();
        } else {
            const result: PlainObject = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = this.serialiseAny(value);
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
            if (this.deserialisers[type]) {
                return this.deserialisers[type](obj) as unknown as T;
            } else {
                throw new ApplicationError(`Unexpected type while deserialising: ${type}`);
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
