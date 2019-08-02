import { instance } from "ts-mockito";

export default function throwingInstance(target: any) {
    let stubbedMethods: Array<string>;

    let handler = {
        get: function(target: any, prop: any, receiver: any) {
            if (stubbedMethods.includes(prop)) {
                return Reflect.get(target, prop);
            } else {
                console.log(prop + " has not been stubbed. Use when() to stub this method before calling it.");
            }
        }
    };

    stubbedMethods = Object.keys((target as any)["tsMockitoInstance"]["mocker"]["methodStubCollections"]);
    let p = new Proxy(instance(target), handler);
    return p;
}
