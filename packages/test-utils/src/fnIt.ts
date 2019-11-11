import { spy } from "ts-mockito";

const getName = <T>(fn: (arg: T) => (...args: any[]) => any) => {
    // create an empty instance
    const dummyInstance = {} as T;
    // spy it to mark up some properties
    const dummySpy: T = spy(dummyInstance);
    // used this 'typed' spy to extract the name
    return fn(dummySpy).name;
};

/**
 * Retrieves a function name from the supplied fn and forms a test name from the name of that function.
 * @param fn
 * @param message
 * @param test
 */
export function fnIt<T>(fn: (t: T) => (...args: any[]) => any, message: string, test?: () => void) {
    return it(getName<T>(fn) + " " + message, test);
}
