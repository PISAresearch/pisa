import { ApplicationError } from "../dataEntities";

export class Lock {
    private waiters: Array<() => void> = [];
    private mLocked = false;

    public get locked() {
        return this.mLocked;
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
        if (!this.mLocked) throw new ApplicationError("Tried to release a Lock that was not locked.");

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
        [key: string]: Lock;
    } = {};

    public async acquire(key: string) {
        if (!this.locks[key]) {
            this.locks[key] = new Lock();
        }

        await this.locks[key].acquire();
    }
    public release(key: string) {
        this.locks[key].release();
        if (!this.locks[key].locked) {
            delete this.locks[key];
        }
    }
}

export class LockUtil {
    private manager = new LockManager();

    public async withLock<T>(key: string, func: () => T): Promise<T> {
        try {
            await this.manager.acquire(key);
            return func();
        } finally {
            await this.manager.release(key);
        }
    }
}
