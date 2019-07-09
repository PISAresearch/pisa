import { ApplicationError } from "../dataEntities";

/**
 * Simple lock class.
 *
 * Use in a try/finally block, calling `release()` in the `finally` block to guarantee the lock is released in any circumstance.
 */
export class Lock {
    private waiters: Array<() => void> = [];
    private mLocked = false;

    public get locked() {
        return this.mLocked;
    }

    /**
     * Acquires the lock; returns a promise that resolves when the lock is acquired.
     * If the lock is already acquired, the Promise is put into a FIFO waiting list, and resolved when all the
     * previously acquired locks are released.
     */
    public async acquire(): Promise<void> {
        if (!this.mLocked) {
            this.mLocked = true;
            return Promise.resolve();
        } else {
            return new Promise(resolve => {
                this.waiters.push(resolve);
            });
        }
    }

    /**
     * Released the lock.
     *
     * @throws ApplicationError if the called when the lock was
     */
    public release() {
        if (!this.mLocked) throw new ApplicationError("Tried to release a Lock that was not locked");

        if (this.waiters.length > 0) {
            // resolve the first waiter in the queue
            const resolve = this.waiters.shift()!;
            resolve();
        } else {
            this.mLocked = false;
        }
    }
}

/**
 * Represents a number of locks indexed by a string `key`.
 * Locks are deleted once they are released, thus the memory occupation is always proportional to the
 * number of currently locked locks.
 */
export class LockManager {
    public static MultiResponderLock = "multi-responder";

    private locks: {
        [key: string]: Lock;
    } = {};

    /**
     * Acquires the lock indexed by `key`.
     *
     * @param key
     */
    public async acquire(key: string) {
        if (!this.locks[key]) {
            this.locks[key] = new Lock();
        }

        await this.locks[key].acquire();
    }

    /**
     * Releases the lock indexed by `key`.
     *
     * @param key
     */
    public release(key: string) {
        if (!this.locks[key]) throw new ApplicationError(`There is no lock for key ${key}`);
        this.locks[key].release();
        if (!this.locks[key].locked) {
            delete this.locks[key];
        }
    }

    /**
     * Acquires the lock indexed by `key` and runs `func`.
     * Resolves to the value to which `func` resolves to, or rejects with the same error.
     * Releases the lock once `func` is resolved or rejected.
     *
     * @param key
     * @param func
     */
    public async withLock<T>(key: string, func: () => Promise<T>): Promise<T> {
        try {
            await this.acquire(key);
            return await func();
        } finally {
            this.release(key);
        }
    }
}
