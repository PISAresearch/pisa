export type Primitive = boolean | number | string | null | undefined;

/**
 * An any object is a primitive, an array, or plain javascript object
 */
export type AnyObject =
    | Primitive
    | Array<AnyObject>
    | {
          [key: string]: AnyObject;
      };

/**
 * A plain javasacript object. Contains primitives and arrays, but is not a primitive or array.
 */
export type PlainObject = {
    [key: string]: AnyObject;
};

/**
 * A value or object that can be stored into the database. It can be any primitive value except `null` or `undefined`,
 * or an arbitrary plain object or array of plain objects or values. The arrays or nested object can contain `null` or `undefined`.
 */
export type DbObject = NonNullable<AnyObject>;
