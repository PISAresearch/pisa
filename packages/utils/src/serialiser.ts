import { BigNumber } from "ethers/utils";
import { ApplicationError } from "@pisa-research/errors";
import { PlainObject, DbObject, AnyObject, Primitive } from "./objects";

/**
 * Plain objects obtained by serialising some other (non-plain)
 * object are marked by having a `_type` member field.
 */
export interface TypedPlainObject extends PlainObject {
    _type: string;
}

/**
 * An object that can be serialised and deserialised.
 * Implementations should also the corresponding public static `deserialise` method.
 * Moreover, they should have a public static readonly constant `TYPE`
 */
export interface Serialisable {
    serialise(): TypedPlainObject;
}

/**
 * An object that is AnyObject or is Serialisable
 * We need this type for recursive serialisation and deserialisation functions.
 */
type AnyObjectOrSerialisable =
    | Serialisable
    | AnyObject
    | AnyObjectOrSerialisable[]
    | {
          [key: string]: AnyObjectOrSerialisable;   
      };

/**
 * An object that is a plain js object or Serialisable
 */
export type PlainObjectOrSerialisable =
    | Serialisable
    | {
          [key: string]: AnyObjectOrSerialisable;
      };

/**
 * A DB object or Serialisable
 */
export type DbObjectOrSerialisable =
    | Serialisable
    | DbObject
    | DbObjectOrSerialisable[]
    | {
          [key: string]: AnyObjectOrSerialisable;
      };

function isPrimitive(value: any): value is Primitive {
    return (typeof value !== "object" && typeof value !== "function") || value == null;
}

export type Deserialisers = {
    [type: string]: (obj: TypedPlainObject) => Serialisable;
};

/**
 * Serialises the objects
 */
export class DbObjectSerialiser {
    constructor(public readonly deserialisers: Deserialisers) {}

    private isSerialisable(obj: any): obj is Serialisable {
        return obj.serialise && obj.serialise instanceof Function;
    }

    private isSerialisedPlainObject(obj: PlainObject): obj is TypedPlainObject {
        return !!obj["_type"];
    }

    private serialiseAnyObject(obj: AnyObjectOrSerialisable): AnyObject {
        if (isPrimitive(obj)) {
            return obj;
        } else if (Array.isArray(obj)) {
            return (obj as AnyObjectOrSerialisable[]).map(item => this.serialiseAnyObject(item));
        } else if (this.isSerialisable(obj)) {
            return obj.serialise();
        } else {
            const result: PlainObject = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = this.serialiseAnyObject(value);
            }
            return result;
        }
    }

    /**
     * Serialise an object to its database representation
     * @param obj
     */
    public serialise(obj: DbObjectOrSerialisable): DbObject {
        // we know that DbObjectOrSerialisable cant be null and that the
        // serialise(AnyObjectOrSerialisable) only returns null when we pass
        // null into it. Which we dont do here.
        return this.serialiseAnyObject(obj)!;
    }

    private deserialiseAnyObject<T>(obj: AnyObject): T {
        if (isPrimitive(obj)) {
            return (obj as unknown) as T;
        } else if (Array.isArray(obj)) {
            return (obj.map(item => this.deserialiseAnyObject(item)) as unknown) as T;
        } else if (this.isSerialisedPlainObject(obj)) {
            const type = obj._type;
            if (this.deserialisers[type]) {
                return (this.deserialisers[type](obj) as unknown) as T;
            } else {
                throw new ApplicationError(`Unexpected type while deserialising: ${type}`);
            }
        } else {
            // generic plain object
            const result: { [key: string]: any } = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = this.deserialiseAnyObject(value);
            }
            return result as T;
        }
    }

    /**
     * Deserialise an object from the database.
     * @param obj
     */
    public deserialise<T>(obj: DbObject): T {
        return this.deserialiseAnyObject(obj);
    }
}

/** A serialised object representing a BigNumber */
type SerialisedBigNumber = TypedPlainObject & {
    value: string;
};

/**
 * A Serialisable version of the BigNumber class.
 */
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

/**
 * Convenience default serialisers config that knows how to handle BigNumbers
 */
export const defaultDeserialisers = {
    [SerialisableBigNumber.TYPE]: SerialisableBigNumber.deserialise
};

/**
 * Convenience default serialiser that can handle BigNumbers
 */
export const defaultSerialiser = new DbObjectSerialiser(defaultDeserialisers);
