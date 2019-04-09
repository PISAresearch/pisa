/**
 * Returns a Promise that resolves after waiting `milliseconds`.
 * @param milliseconds
 */
export const wait = (milliseconds: number) => {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
};


/** A custom error to signal a timeout. */
export class TimeoutError extends Error {
    constructor(...params: any) {
        super(...params);
        this.name = "TimeoutError";
    }
}

/**
 * Wraps `promise` in a new promise that rejects with a `TimeoutError` after waiting `milliseconds` if `promise` is still pending.
 *
 * @param promise the original promise
 * @param milliseconds the amount of milliseconds before the returned promise is rejected.
 */
export function promiseTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => {
            const timerId = setTimeout(() => {
                clearTimeout(timerId);
                reject(new TimeoutError('Timed out in '+ milliseconds + 'ms.'));
            }, milliseconds)
        })
    ]);
}