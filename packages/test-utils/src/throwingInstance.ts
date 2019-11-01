import { instance } from "ts-mockito";
import * as chai from "chai";

/**
 * Creates an instance of a mocked object. Calls to methods or properties that have not been stubbed will throw errors
 */
export function throwingInstance<TMock extends object>(target: TMock) {
    const stubbedMethods: Array<string> = Object.keys(
        (target as any)["tsMockitoInstance"]["mocker"]["methodStubCollections"]
    );

    const handler = {
        get: function(target: TMock, prop: string, receiver: any) {
            if (stubbedMethods.includes(prop)) {
                return Reflect.get(target, prop);
            } else {
                // fail any tests using this instance
                chai.assert.fail(undefined, prop, prop + " has not been stubbed. Use when() to stub this method before calling it.")
            }
        }
    };

    return new Proxy(instance(target), handler);
}
