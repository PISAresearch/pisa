

export type Primitive = boolean | number | string;
export type MaybePrimitive = Primitive | null | undefined;

export type PlainObject = {
    [key: string]: MaybePrimitive | PlainObject | Array<MaybePrimitive> | Array<PlainObject>
};
