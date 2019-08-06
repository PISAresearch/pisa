import { instance } from "ts-mockito";

/**
 * Creates an instance of a mocked object. Calls to methods or properties that have not been stubbed will throw errors
 */
export default function throwingInstance<TMock extends object>(target: TMock) {
    const stubbedMethods: Array<string> = Object.keys(
        (target as any)["tsMockitoInstance"]["mocker"]["methodStubCollections"]
    );

    const handler = {
        get: function(target: TMock, prop: string, receiver: any) {
            if (stubbedMethods.includes(prop)) {
                return Reflect.get(target, prop);
            } else {
                //We use this to print the error. Throwing an error will not always be called as some other error(indirect consquence of not stubbing) might catch and not log the error
                console.log(prop + " has not been stubbed. Use when() to stub this method before calling it.");
            }
        }
    };

    return new Proxy(instance(target), handler);
}
