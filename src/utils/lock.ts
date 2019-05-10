import { ApplicationError } from "../dataEntities";

export class Lock {
    private waiters: Array<() => void>;
    private mLocked = false;
    public get locked() {
        return this.mLocked;
    }

    constructor() {
        this.waiters = [];
    }

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

    public release() {
        if (!this.locked) {
            throw new ApplicationError("Tried to release a Lock that was not locked.");
        }
        if (this.waiters.length > 0) {
            // resolve the first waiter in the queue
            const resolve = this.waiters.shift()!;
            resolve();
        } else {
            this.mLocked = false;
        }
    }
}

export class LockManager {
    private locks: {
        [id: string]: Lock;
    } = {};

    public withLock<T>(id: string, f: () => T): Promise<T> {
        return new Promise(async (resolve, reject) => {
            if (!this.locks[id]) {
                this.locks[id] = new Lock();
            }

            try {
                await this.locks[id].acquire;
                const res = await f();
                resolve(res);
            } catch (err) {
                reject(err);
            } finally {
                this.locks[id].release();
                if (!this.locks[id].locked) {
                    delete this.locks[id];
                }
            }
        });
    }
}
