import { instance } from "ts-mockito";

/**
 * This will be useful for detecting when certain methods have not been stubbed.
 * @param target will take the mocked object
 */
export default function throwingInstance(target: any) {
    let stubbedMethods: Array<string>;

    let handler = {
        get: function(target: any, prop: any, receiver: any) {
            if (stubbedMethods.includes(prop)) {
                return Reflect.get(target, prop);
            } else {
                //We use this to print the error. Throwing an error will not always be called as some other error(indirect consquence of not stubbing) might catch and not log the error
                console.log(prop + " has not been stubbed. Use when() to stub this method before calling it.");
            }
        }
    };

    stubbedMethods = Object.keys((target as any)["tsMockitoInstance"]["mocker"]["methodStubCollections"]);
    let p = new Proxy(instance(target), handler);
    return p;
}
