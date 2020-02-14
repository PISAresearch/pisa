import { BigNumber } from "ethers/utils";

export type Primitive = boolean | number | string | null | undefined;

export type PlainObject =
    | Primitive
    | Array<PlainObject>
    | {
          [key: string]: PlainObject | Array<PlainObject>;
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

type PlainObjectOrSerialisable =
    | PlainObject
    | Serialisable
    | Array<PlainObjectOrSerialisable>
    | {
          [key: string]: PlainObjectOrSerialisable;
      };

function isPrimitive(value: any): value is Primitive {
    return (typeof value !== "object" && typeof value !== "function") || value == null;
}

function isSerialisable(obj: any): obj is Serialisable {
    return obj.serialise && obj.serialise instanceof Function;
}

function isSerialisedPlainObject(obj: { [key: string]: PlainObject | Array<PlainObject> }): obj is TypedPlainObject {
    return "_type" in Object.keys(obj);
}

function serialise(obj: PlainObjectOrSerialisable): PlainObject {
    if (isPrimitive(obj)) {
        return obj;
    } else if (Array.isArray(obj)) {
        return (obj as PlainObjectOrSerialisable[]).map(item => serialise(item));
    } else if (isSerialisable(obj)) {
        return obj.serialise();
    } else {
        const result: PlainObject = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = serialise(value);
        }
        return result;
    }
}

function deserialise<T>(obj: PlainObject): T {
    if (isPrimitive(obj)) {
        return (obj as unknown) as T;
    } else if (Array.isArray(obj)) {
        return obj.map(item => deserialise(item)) as unknown as T;
    } else if (isSerialisedPlainObject(obj)) {
        const type = obj._type;
        switch (type) {
            case SerialisableType.BigNumber:
                return SerialisableBigNumber.deserialise(obj) as unknown as T;
        }
    } else {
        // generic plain object
        const result: {[key: string]: any} = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = deserialise(value);
        }
        return result as T;
    }
}
