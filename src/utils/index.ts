/**
 * Returns a Promise that resolves after waiting `milliseconds`.
 * @param milliseconds
 */
export const wait = (milliseconds: number) => {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
};


/** A custom error to signal a timeout. */
export class TimeoutError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TimeoutError";
    }
}


/**
 * A promise that can be canceled to release any resource.
 * Instances of this class should guarantee that all resources will eventually be released if `cancel()` is called,
 * regardless of wether the Promise is fulfilled or rejected.
 *
 * Once `cancel()` is called, the behaviour of the promise is undefined, and the caller
 * should not expect it to reject or fulfill, nor to be pending forever.
 */
export class CancellablePromise<T> extends Promise<T> {
    constructor(
        executor: (resolve: (value?: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void,
        private canceller: () => void
    ) {
        super(executor);
    }

    /**
     * If a canceller was provided in the constructor, it calls it. Then it sets `cancelled` to true.
     */
    public cancel() {
        this.canceller();
    }
}


/**
 * Wraps `promise` in a new promise that rejects with a `TimeoutError` after waiting `milliseconds` if `promise` is still pending.
 *
 * @param promise the original promise
 * @param milliseconds the amount of milliseconds before the returned promise is rejected
 */
export function promiseTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => {
            setTimeout(() => {
                reject(new TimeoutError('Timed out in '+ milliseconds + 'ms.'));
            }, milliseconds)
        })
    ]);
}

/**
 * Returns `word` if `val` is 1, `plural` otherwise.
 *
 * @param val the number to be tested
 * @param word the string to be used as singular
 * @param [plural] the string to be used as plural; defaults to `word + 's'`.
 */
export function plural(val: number, word: string, plural: string = word + 's') {
    return val == 1 ? word : plural;
}
