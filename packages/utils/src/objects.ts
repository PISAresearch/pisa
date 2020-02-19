export type Primitive = boolean | number | string | null | undefined;

export type AnyObject =
    | Primitive
    | Array<AnyObject>
    | PlainObject;


export type PlainObject = {
    [key: string]: AnyObject;
};

/**
 * A value or object that can be stored into the database. It can be any primitive value except `null` or `undefined`,
 * or an arbitrary plain object or array of plain objects or values. The arrays or nested object can contain `null` or `undefined`.
 */
export type DbObject = boolean | number | string | AnyObject[] | PlainObject;
