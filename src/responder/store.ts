import { StartStopService } from "../dataEntities";
import { GasQueueItem, GasQueue } from "./gasQueue";
import { LevelUp } from "levelup";
import EncodingDown from "encoding-down";
const sub = require("subleveldown");

export class ResponderStore extends StartStopService {
    public get transactions(): ReadonlyMap<string, GasQueueItem> {
        return this.mTransactions;
    }
    private readonly mTransactions: Map<string, GasQueueItem> = new Map();
    /**
     * A single global lock on this store to be taken out whenever reading or
     * writing to the store.
     */
    public readonly lock: string;
    private mQueue: GasQueue;
    public get queue() {
        return this.mQueue;
    }

    private readonly subDb: LevelUp<EncodingDown<string, any>>;
    private readonly queueKey: string;
    /**
     * A persistent store for responder data.
     * @param db A backend database for the store
     * @param responderAddress The address of the responder using this store. Responder public keys can only
     * be used by one responder at a time.
     */
    constructor(db: LevelUp<EncodingDown<string, any>>, responderAddress: string, seedQueue: GasQueue) {
        super("responder-store");
        this.subDb = sub(db, `responder:${responderAddress}`, { valueEncoding: 'json' });
        this.mQueue = seedQueue;
        this.queueKey = `${responderAddress}:queue`;
        this.lock = responderAddress;
    }

    protected async startInternal() {
        // buffer any existing state
        const { queue, respondedTransactions } = await this.getAll();
        if (queue) {
            this.mQueue = new GasQueue(
                queue.queueItems,
                queue.emptyNonce,
                this.mQueue.replacementRate,
                this.mQueue.maxQueueDepth
            );
        }

        for (const [key, value] of respondedTransactions.entries()) {
            this.mTransactions.set(key, value);
        }
    }
    protected async stopInternal() {}

    /**
     * Update the queue. Returns a new transactions that need to be issued as result of the update.
     * @param queue
     */
    public async updateQueue(queue: GasQueue) {
        // const replacedQueue = this.zQueue.add(request);
        const difference = queue.difference(this.mQueue);
        this.mQueue = queue;

        // update these transactions locally and in the db
        const differenceById = new Map<string, GasQueueItem>();
        difference.forEach(d => {
            const id = d.request.appointment.id
            this.mTransactions.set(id, d);
            differenceById.set(id, d);
        });

        let batch = this.subDb.batch().put(this.queueKey, GasQueue.serialise(queue));
        for (const [key, value] of differenceById.entries()) {
            batch = batch.put(key, GasQueueItem.serialise(value));
        }
        await batch.write();

        return difference;
    }

    /**
     * Remove a response keyed by its id
     * @param id
     */
    public async removeResponse(id: string) {
        this.mTransactions.delete(id);
        await this.subDb.del(id);
    }

    /**
     * Get the full contents of the database. One queue, and a map of responded transactions
     */
    private async getAll(): Promise<{
        queue: GasQueue | undefined;
        respondedTransactions: ReadonlyMap<string, GasQueueItem>;
    }> {
        let queue;
        const transactions = new Map();
        for await (const keyValue of this.subDb.createReadStream()) {
            const { key, value } = keyValue as any;
            if (key === this.queueKey) {
                // this is the queue
                queue = GasQueue.deserialise(value);
            } else {
                // this is a transactions
                transactions.set(key, GasQueueItem.deserialise(value));
            }
        }

        return { queue: queue, respondedTransactions: transactions };
    }
}