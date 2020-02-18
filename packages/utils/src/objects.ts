export type Primitive = boolean | number | string | null | undefined;

export type AnyObject =
    | Primitive
    | Array<AnyObject>
    | PlainObject;

export type PlainObject = {
    [key: string]: AnyObject;
};

export type DbObject = boolean | number | string | AnyObject[] | PlainObject;
