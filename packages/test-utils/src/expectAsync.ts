import { expect } from "chai";

/**
 * Used in place of expect to asynchronously test for a Promise's outcome with chai-as-promised, while awaiting for it.
 * Example usage:
 *      `(await expectAsync(somePromise)).to.throw(SomeError)`
 * @param target The promise to be tested.
 */
export const expectAsync = async <TReturn>(target: Promise<TReturn>) => {
    try {
        return expect(await target);
    } catch (err) {
        return expect(() => {
            throw err;
        });
    }
};