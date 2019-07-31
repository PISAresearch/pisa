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
 * A test fixture for a specific function. The supplied function will be used to name the test.
 * This will be useful when refactoring since there is no need to go back an change all the tests manually in case a function name has been changed.
 * Types of T that are generic can be declared with 'any' eg. fnIt<BlockCache<any>>(b => b.setHead, ...)
 */
export default function fnIt<T>(fn: (t: T) => (...args: any[]) => any, message: string, test: () => void) {
    return it(getName<T>(fn) + " " + message, test);
}
