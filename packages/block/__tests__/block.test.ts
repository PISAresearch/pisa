import "mocha";
import { expect } from "chai";
import LevelUp from "levelup";
import EncodingDown from "encoding-down";
import MemDown from "memdown";
import { hasLogMatchingEventFilter, IBlockStub, Logs, BlockItemStore } from "../src";
import { ArgumentError, ApplicationError } from "@pisa-research/errors";
import { fnIt, wait } from "@pisa-research/test-utils";
import { DbObject, defaultSerialiser } from "@pisa-research/utils";

describe("hasLogMatchingEventFilter", () => {
    const address = "0x1234abcd";
    const addressDifferentCase = "0x1234AbCd"; // should match anyway
    const topics = ["0xaabbccdd"];
    const topicsDifferentCase = ["0xAaBbCcDd"]; // should match anyway

    const blockHasLogs: Logs = {
        logs: [
            {
                address,
                data: "",
                topics
            }
        ]
    };

    const blockDoesNotHaveLogs: Logs = {
        logs: [
            {
                address,
                data: "",
                topics: ["0xbeef"] // different topics
            }
        ]
    };

    it("returns true if an appropriate log is present", () => {
        expect(hasLogMatchingEventFilter(blockHasLogs, { address, topics })).to.be.true;
        expect(hasLogMatchingEventFilter(blockHasLogs, { address: addressDifferentCase, topics }), "matches even if address' case is different").to.be.true;
        expect(hasLogMatchingEventFilter(blockHasLogs, { address, topics: topicsDifferentCase }), "matches even if topics' case is different").to.be.true;
    });

    it("returns false if an appropriate log is not present", () => {
        expect(hasLogMatchingEventFilter(blockDoesNotHaveLogs, { address, topics })).to.be.false;
        expect(hasLogMatchingEventFilter(blockHasLogs, { address: "0xanotheraddress", topics })).to.be.false;
    });
    it("throws ArgumentError if no address is provided", () => {
        expect(() => hasLogMatchingEventFilter(blockHasLogs, { topics })).to.throw(ArgumentError);
    });
    it("throws ArgumentError if no topics member is present in filter", () => {
        expect(() => hasLogMatchingEventFilter(blockHasLogs, { address })).to.throw(ArgumentError);
    });
});

describe("BlockItemStore", () => {
    let db: any;
    let store: BlockItemStore<IBlockStub>;

    const sampleKey = "foo";
    const sampleValue = {
        bar: 42
    };

    const block10a = {
        number: 10,
        hash: "0xaaaa",
        parentHash: "0x1111"
    };
    const block10b = {
        number: 10,
        hash: "0xbbbb",
        parentHash: "0x2222"
    };
    const block42 = {
        number: 42,
        hash: "0x4242",
        parentHash: "0x3333"
    };

    const sampleBlocks: IBlockStub[] = [block10a, block10b, block42];

    async function addSampleData(bis: BlockItemStore<IBlockStub>) {
        await store.withBatch(async () => {
            bis.putBlockItem(block10a.number, block10a.hash, "block", block10a);
            bis.putBlockItem(block10a.number, block10a.hash, "attached", true);
            bis.putBlockItem(block42.number, block42.hash, "block", block42);
            bis.putBlockItem(block42.number, block42.hash, "attached", true);
            bis.putBlockItem(block10b.number, block10b.hash, "block", block10b);
            bis.putBlockItem(block10b.number, block10b.hash, "attached", false);
        });
    }

    beforeEach(async () => {
        db = LevelUp(
            EncodingDown<string, DbObject>(MemDown(), { valueEncoding: "json" })
        );
        store = new BlockItemStore<IBlockStub>(db, defaultSerialiser);
        await store.start();
    });

    afterEach(async () => {
        await store.stop();
    });

    it("can store and retrieve an item", async () => {
        await store.withBatch(async () => store.putBlockItem(sampleBlocks[0].number, sampleBlocks[0].hash, sampleKey, sampleValue));

        const storedItem = store.getItem(sampleBlocks[0].hash, sampleKey);

        expect(storedItem).to.deep.equal(sampleValue);
    });

    fnIt<BlockItemStore<any>>(
        b => b.putBlockItem,
        "throws ApplicationError if not executed within a withBatch callback",
        async () => {
            expect(() => store.putBlockItem(42, "0x424242", "test", {})).to.throw(ApplicationError);
        }
    );

    fnIt<BlockItemStore<any>>(
        b => b.withBatch,
        "rejects with the same error if the callback rejects",
        async () => {
            const doh = new Error("Oh no!");
            expect(
                store.withBatch(async () => {
                    throw doh;
                })
            ).to.be.rejectedWith(doh);
        }
    );

    fnIt<BlockItemStore<any>>(
        b => b.withBatch,
        "timesout if a batch was already open",
        async () => {
            await store.withBatch(async () => {
                const startTime = Date.now();
                await Promise.race([store.withBatch(async () => {}), wait(1000)]);

                expect(Date.now() - startTime).to.be.gte(1000);
                expect(Date.now() - startTime).to.be.lessThan(2000);
            });
        }
    );

    fnIt<BlockItemStore<any>>(
        b => b.getBlocksAtHeight,
        "gets all the blocks at a specific height and correctly reads the `attached` property",
        async () => {
            await addSampleData(store);

            // sort the returned elements, as order is not relevant
            const result = store.getBlocksAtHeight(10).sort((a, b) => (a.block.hash < b.block.hash ? -1 : 1));

            expect(result.length, "returns the right number of blocks").to.equal(2);
            expect(result[0].block).to.deep.equal(block10a);
            expect(result[0].attached).to.be.true;
            expect(result[1].block).to.deep.equal(block10b);
            expect(result[1].attached).to.be.false;
        }
    );

    fnIt<BlockItemStore<any>>(
        b => b.deleteItemsAtHeight,
        "deletes all the items at a specific height",
        async () => {
            await addSampleData(store);

            await store.withBatch(async () => store.deleteItemsAtHeight(10));

            // Check that all items at height 10 return undefined, but all the others are not changed
            expect(store.getItem(block10a.hash, "block")).to.be.undefined;
            expect(store.getItem(block10a.hash, "attached")).to.be.undefined;
            expect(store.getItem(block42.hash, "block")).to.deep.include(block42);
            expect(store.getItem(block42.hash, "attached")).to.be.true;
            expect(store.getItem(block10b.hash, "block")).to.be.undefined;
            expect(store.getItem(block10b.hash, "attached")).to.be.undefined;
        }
    );

    it("actually persists items into the database", async () => {
        await addSampleData(store);
        await store.stop();

        // New store using the same db
        const newStore = new BlockItemStore<IBlockStub>(db, defaultSerialiser);
        await newStore.start();

        // Check that all items still return the correct value for the new store
        expect(newStore.getItem(block10a.hash, "block")).to.deep.include(block10a);
        expect(newStore.getItem(block10a.hash, "attached")).to.be.true;
        expect(newStore.getItem(block42.hash, "block")).to.deep.include(block42);
        expect(newStore.getItem(block42.hash, "attached")).to.be.true;
        expect(newStore.getItem(block10b.hash, "block")).to.deep.include(block10b);
        expect(newStore.getItem(block10b.hash, "attached")).to.be.false;
    });
});
