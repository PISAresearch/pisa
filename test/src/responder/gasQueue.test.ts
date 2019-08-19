import "mocha";
import { expect } from "chai";
import {
    GasQueue,
    GasQueueItem,
    GasQueueItemRequest,
    PisaTransactionIdentifier
} from "../../../src/responder/gasQueue";
import { ArgumentError, Appointment } from "../../../src/dataEntities";
import { BigNumber } from "ethers/utils";
import fnIt from "../../utils/fnIt";

const createIdentifier = (data: string, to: string) => {
    return new PisaTransactionIdentifier(1, data, to, new BigNumber(0), new BigNumber(500));
};

const createAppointment = (id: number): Appointment => {
    return Appointment.fromIAppointment({
        challengePeriod: 10,
        contractAddress: "contractAddress",
        customerAddress: "customerAddress",
        data: "data",
        endBlock: 10,
        eventABI: "eventABI",
        eventArgs: "eventArgs",
        gasLimit: "100",
        customerChosenId: id,
        jobId: 1,
        mode: 1,
        paymentHash: "paymentHash",
        preCondition: "preCondition",
        postCondition: "postCondition",
        refund: "3",
        startBlock: 7,
        customerSig: "sig"
    });
};

const createGasQueueItem = (
    appointmentId: number,
    nonce: number,
    idealGasPrice: BigNumber,
    currentGasPrice: BigNumber,
    identifier: PisaTransactionIdentifier
) => {
    return new GasQueueItem(
        new GasQueueItemRequest(identifier, idealGasPrice, createAppointment(appointmentId), 0),
        currentGasPrice,
        idealGasPrice,
        nonce
    );
};

const checkClone = (queue: GasQueue, newQueue: GasQueue) => {
    expect(queue).to.not.equal(newQueue);
    expect(queue.queueItems).to.not.equal(newQueue.queueItems);
};

const replacedGasPrice = (rate: number, currentGasPrice: BigNumber) => {
    const rRate = new BigNumber(rate).add(100);
    return currentGasPrice.mul(rRate).div(100);
};

describe("GasQueueItem", () => {
    it("constructor", () => {
        createGasQueueItem(1, 1, new BigNumber(10), new BigNumber(10), createIdentifier("data", "to"));
    });

    it("constructor does not accept current gas less than ideal gas", () => {
        expect(() =>
            createGasQueueItem(1, 1, new BigNumber(10), new BigNumber(9), createIdentifier("data", "to"))
        ).to.throw(ArgumentError);
    });
});

describe("GasQueue", () => {
    it("constructor accepts empty array", () => {
        new GasQueue([], 0, 1, 1);
    });

    it("constructor throws for negative nonce", () => {
        expect(() => new GasQueue([], -1, 1, 1)).to.throw(ArgumentError);
    });

    it("constructor throws for too low replacement rate", () => {
        expect(() => new GasQueue([], 1, 0.9, 1)).to.throw(ArgumentError);
    });

    it("constructor throws for 0 max queue depth", () => {
        expect(() => new GasQueue([], 1, 1, 0)).to.throw(ArgumentError);
    });

    it("constructor can contain items", () => {
        const items = [createGasQueueItem(1, 1, new BigNumber(10), new BigNumber(10), createIdentifier("data", "to"))];
        new GasQueue(items, 2, 1, 1);
    });

    it("constructor emptyNonce must be last item nonce plus one", () => {
        const items = [createGasQueueItem(1, 1, new BigNumber(10), new BigNumber(10), createIdentifier("data", "to"))];
        expect(() => new GasQueue(items, 3, 1, 1)).to.throw(ArgumentError);
    });

    it("constructor items cannot be more than max depth", () => {
        const items = [
            createGasQueueItem(1, 1, new BigNumber(10), new BigNumber(10), createIdentifier("data", "to")),
            createGasQueueItem(2, 2, new BigNumber(9), new BigNumber(9), createIdentifier("data1", "to1"))
        ];
        expect(() => new GasQueue(items, 3, 1, 1)).to.throw(ArgumentError);
    });

    it("constructor does accept multiple items", () => {
        const items = [
            createGasQueueItem(1, 1, new BigNumber(10), new BigNumber(10), createIdentifier("data", "to")),
            createGasQueueItem(2, 2, new BigNumber(9), new BigNumber(9), createIdentifier("data1", "to1"))
        ];
        new GasQueue(items, 3, 1, 2);
    });

    it("constructor does not accept multiple items with same identifier", () => {
        const items = [
            createGasQueueItem(1, 1, new BigNumber(10), new BigNumber(10), createIdentifier("data", "to")),
            createGasQueueItem(2, 2, new BigNumber(9), new BigNumber(9), createIdentifier("data", "to"))
        ];
        expect(() => new GasQueue(items, 3, 1, 2)).to.throw(ArgumentError);
    });

    it("constructor does accept multiple items with the same ideal gas and current gas", () => {
        const items = [
            createGasQueueItem(1, 1, new BigNumber(10), new BigNumber(10), createIdentifier("data", "to")),
            createGasQueueItem(2, 2, new BigNumber(9), new BigNumber(9), createIdentifier("data1", "to1"))
        ];
        new GasQueue(items, 3, 1, 2);
    });

    it("constructor item nonce must increase by 1", () => {
        let items = [
            createGasQueueItem(1, 1, new BigNumber(10), new BigNumber(10), createIdentifier("data", "to")),
            createGasQueueItem(2, 3, new BigNumber(9), new BigNumber(9), createIdentifier("data1", "to1"))
        ];
        expect(() => new GasQueue(items, 3, 1, 2)).to.throw(ArgumentError);

        items = [
            createGasQueueItem(1, 1, new BigNumber(10), new BigNumber(10), createIdentifier("data", "to")),
            createGasQueueItem(2, 1, new BigNumber(9), new BigNumber(9), createIdentifier("data1", "to1"))
        ];
        expect(() => new GasQueue(items, 3, 1, 2)).to.throw(ArgumentError);
    });

    it("constructor item gas price cannot increase", () => {
        const items = [
            createGasQueueItem(1, 1, new BigNumber(10), new BigNumber(14), createIdentifier("data", "to")),
            createGasQueueItem(2, 2, new BigNumber(11), new BigNumber(13), createIdentifier("data1", "to1"))
        ];
        expect(() => new GasQueue(items, 3, 1, 2)).to.throw(ArgumentError);
    });

    it("constructor items current gas price can decrease", () => {
        const items = [
            createGasQueueItem(1, 1, new BigNumber(10), new BigNumber(12), createIdentifier("data", "to")),
            createGasQueueItem(2, 2, new BigNumber(9), new BigNumber(13), createIdentifier("data1", "to1"))
        ];
        new GasQueue(items, 3, 1, 2);
    });

    fnIt<GasQueue>(g => g.add, "does append for lowest gas", () => {
        const emptyNonce = 3;
        const maxQueueDepth = 5;
        const replacementRate = 15;

        const items = [
            createGasQueueItem(1, 1, new BigNumber(10), new BigNumber(12), createIdentifier("data", "to")),
            createGasQueueItem(2, 2, new BigNumber(9), new BigNumber(11), createIdentifier("data1", "to1"))
        ];
        const request = new GasQueueItemRequest(
            createIdentifier("data2", "to2"),
            new BigNumber(8),
            createAppointment(1),
            0
        );

        const queue = new GasQueue(items, emptyNonce, replacementRate, maxQueueDepth);
        const appendedQueue = queue.add(request);

        expect(appendedQueue.emptyNonce).to.equal(emptyNonce + 1);
        expect(appendedQueue.maxQueueDepth).to.equal(maxQueueDepth);
        expect(appendedQueue.replacementRate).to.equal(replacementRate);

        expect(appendedQueue.queueItems[2].nonce).to.equal(3);
        expect(appendedQueue.queueItems[2].request).to.equal(request);
        expect(appendedQueue.queueItems[2].idealGasPrice).to.equal(request.idealGasPrice);
        expect(appendedQueue.queueItems[2].nonceGasPrice).to.equal(request.idealGasPrice);

        checkClone(queue, appendedQueue);
    });

    fnIt<GasQueue>(g => g.add, "does replace for middle gas", () => {
        const emptyNonce = 4;
        const maxQueueDepth = 5;
        const replacementRate = 15;
        const items = [
            createGasQueueItem(1, 1, new BigNumber(150), new BigNumber(150), createIdentifier("data", "to")),
            createGasQueueItem(2, 2, new BigNumber(100), new BigNumber(100), createIdentifier("data1", "to1")),
            createGasQueueItem(3, 3, new BigNumber(80), new BigNumber(80), createIdentifier("data2", "to2"))
        ];
        const request = new GasQueueItemRequest(
            createIdentifier("data3", "to3"),
            new BigNumber(110),
            createAppointment(1),
            0
        );

        const queue = new GasQueue(items, emptyNonce, replacementRate, maxQueueDepth);
        const appendedQueue = queue.add(request);

        expect(appendedQueue.emptyNonce).to.equal(emptyNonce + 1);
        expect(appendedQueue.maxQueueDepth).to.equal(maxQueueDepth);
        expect(appendedQueue.replacementRate).to.equal(replacementRate);

        expect(appendedQueue.queueItems[1].nonce).to.equal(2);
        expect(appendedQueue.queueItems[1].request).to.equal(request);
        expect(appendedQueue.queueItems[1].idealGasPrice).to.equal(request.idealGasPrice);
        expect(appendedQueue.queueItems[1].nonceGasPrice.toNumber()).to.equal(
            replacedGasPrice(replacementRate, new BigNumber(100)).toNumber()
        );

        expect(appendedQueue.queueItems[2].nonce).to.equal(3);
        expect(appendedQueue.queueItems[2].request).to.equal(queue.queueItems[1].request);
        expect(appendedQueue.queueItems[2].idealGasPrice).to.equal(queue.queueItems[1].idealGasPrice);
        expect(appendedQueue.queueItems[2].nonceGasPrice.toNumber()).to.equal(
            queue.queueItems[1].nonceGasPrice.toNumber()
        );

        expect(appendedQueue.queueItems[3].nonce).to.equal(4);
        expect(appendedQueue.queueItems[3].request).to.equal(queue.queueItems[2].request);
        expect(appendedQueue.queueItems[3].idealGasPrice).to.equal(queue.queueItems[2].idealGasPrice);
        expect(appendedQueue.queueItems[3].nonceGasPrice.toNumber()).to.equal(
            queue.queueItems[2].nonceGasPrice.toNumber()
        );

        checkClone(queue, appendedQueue);
    });

    fnIt<GasQueue>(g => g.add, "throws expection if depth reached", () => {
        const items = [
            createGasQueueItem(1, 1, new BigNumber(150), new BigNumber(150), createIdentifier("data", "to")),
            createGasQueueItem(2, 2, new BigNumber(100), new BigNumber(100), createIdentifier("data1", "to1")),
            createGasQueueItem(3, 3, new BigNumber(80), new BigNumber(80), createIdentifier("data2", "to2"))
        ];
        const request = new GasQueueItemRequest(
            createIdentifier("data3", "to3"),
            new BigNumber(110),
            createAppointment(1),
            0
        );

        const queue = new GasQueue(items, 4, 15, 3);
        expect(() => queue.add(request)).to.throw(ArgumentError);
    });

    fnIt<GasQueue>(g => g.consume, "to remove queue item", () => {
        const emptyNonce = 4;
        const replacementRate = 15;
        const maxQueueDepth = 5;
        const consumedIdentifier = createIdentifier("data1", "to1");
        const items = [
            createGasQueueItem(1, 1, new BigNumber(110), new BigNumber(110), createIdentifier("data", "to")),
            createGasQueueItem(2, 2, new BigNumber(100), new BigNumber(100), consumedIdentifier),
            createGasQueueItem(3, 3, new BigNumber(80), new BigNumber(80), createIdentifier("data2", "to2"))
        ];

        const queue = new GasQueue(items, emptyNonce, replacementRate, maxQueueDepth);
        const consumedQueue = queue.consume(consumedIdentifier);

        // item 2 has been removed - and item 1 takes it's position (bumped nonce + gasPrice)
        expect(consumedQueue.emptyNonce).to.equal(emptyNonce);
        expect(consumedQueue.maxQueueDepth).to.equal(maxQueueDepth);
        expect(consumedQueue.replacementRate).to.equal(replacementRate);

        expect(consumedQueue.queueItems[0].nonce).to.equal(2);
        expect(consumedQueue.queueItems[0].request).to.equal(items[0].request);
        expect(consumedQueue.queueItems[0].idealGasPrice).to.equal(items[0].request.idealGasPrice);
        expect(consumedQueue.queueItems[0].nonceGasPrice.toNumber()).to.equal(115);

        // // unchanged next item
        expect(consumedQueue.queueItems[1].nonce).to.equal(queue.queueItems[2].nonce);
        expect(consumedQueue.queueItems[1].request).to.equal(queue.queueItems[2].request);
        expect(consumedQueue.queueItems[1].idealGasPrice).to.equal(queue.queueItems[2].idealGasPrice);
        expect(consumedQueue.queueItems[1].nonceGasPrice).to.equal(queue.queueItems[2].nonceGasPrice);

        expect(consumedQueue.queueItems.length).to.equal(queue.queueItems.length - 1);

        checkClone(queue, consumedQueue);
    });

    fnIt<GasQueue>(g => g.consume, "to throw for unknown identifier", () => {
        const emptyNonce = 4;
        const replacementRate = 15;
        const maxQueueDepth = 5;
        const consumedIdentifier = createIdentifier("data1", "to1");
        const items = [
            createGasQueueItem(1, 1, new BigNumber(110), new BigNumber(110), createIdentifier("data", "to")),
            createGasQueueItem(2, 2, new BigNumber(100), new BigNumber(100), consumedIdentifier),
            createGasQueueItem(3, 3, new BigNumber(80), new BigNumber(80), createIdentifier("data2", "to2"))
        ];

        const queue = new GasQueue(items, emptyNonce, replacementRate, maxQueueDepth);
        expect(() => queue.consume(createIdentifier("data3", "to3"))).to.throw(ArgumentError);
    });

    fnIt<GasQueue>(g => g.dequeue, "to remove first element only", () => {
        const emptyNonce = 4;
        const replacementRate = 15;
        const maxQueueDepth = 5;
        const items = [
            createGasQueueItem(1, 1, new BigNumber(110), new BigNumber(110), createIdentifier("data", "to")),
            createGasQueueItem(2, 2, new BigNumber(100), new BigNumber(100), createIdentifier("data1", "to1")),
            createGasQueueItem(3, 3, new BigNumber(80), new BigNumber(80), createIdentifier("data2", "to2"))
        ];

        const queue = new GasQueue(items, emptyNonce, replacementRate, maxQueueDepth);
        const dequeuedQueue = queue.dequeue();

        expect(dequeuedQueue.emptyNonce).to.equal(emptyNonce);
        expect(dequeuedQueue.maxQueueDepth).to.equal(maxQueueDepth);
        expect(dequeuedQueue.replacementRate).to.equal(replacementRate);

        expect(dequeuedQueue.queueItems.length).to.equal(2);
        expect(dequeuedQueue.queueItems[0]).to.equal(queue.queueItems[1]);
        expect(dequeuedQueue.queueItems[1]).to.equal(queue.queueItems[2]);

        checkClone(queue, dequeuedQueue);
    });

    fnIt<GasQueue>(g => g.difference, "correctly returns missing items", () => {
        const items = [
            createGasQueueItem(1, 1, new BigNumber(110), new BigNumber(110), createIdentifier("data", "to")),
            createGasQueueItem(2, 2, new BigNumber(100), new BigNumber(100), createIdentifier("data1", "to1"))
        ];

        const addItem1 = createGasQueueItem(
            1,
            3,
            new BigNumber(80),
            new BigNumber(80),
            createIdentifier("data2", "to2")
        );
        const addItem2 = createGasQueueItem(
            1,
            4,
            new BigNumber(80),
            new BigNumber(80),
            createIdentifier("data3", "to3")
        );
        const items2 = [...items, addItem1, addItem2];

        const q1 = new GasQueue(items, 3, 15, 5);
        const q2 = new GasQueue(items2, 5, 15, 5);

        const diffItems = q2.difference(q1);
        expect(diffItems).to.deep.equal([addItem1, addItem2]);

        const diff2Items = q1.difference(q2);
        expect(diff2Items).to.deep.equal([]);
    });

    fnIt<GasQueue>(g => g.contains, "identifier is correctly identified", () => {
        const id1 = createIdentifier("data", "to");
        const id2 = createIdentifier("data1", "to1");
        const id3 = createIdentifier("data2", "to2");
        const items = [
            createGasQueueItem(1, 1, new BigNumber(110), new BigNumber(110), id1),
            createGasQueueItem(2, 2, new BigNumber(100), new BigNumber(100), id2),
            createGasQueueItem(3, 3, new BigNumber(80), new BigNumber(80), id3)
        ];

        const q = new GasQueue(items, 4, 15, 5);
        expect(q.contains(id1)).to.be.true;
        expect(q.contains(id2)).to.be.true;
        expect(q.contains(id3)).to.be.true;
    });

    fnIt<GasQueue>(g => g.contains, "identifier is correctly identified", () => {
        const missingId = createIdentifier("data3", "to3");
        const items = [
            createGasQueueItem(1, 1, new BigNumber(110), new BigNumber(110), createIdentifier("data", "to")),
            createGasQueueItem(2, 2, new BigNumber(100), new BigNumber(100), createIdentifier("data1", "to1")),
            createGasQueueItem(3, 3, new BigNumber(80), new BigNumber(80), createIdentifier("data2", "to2"))
        ];

        const q = new GasQueue(items, 4, 15, 5);
        const contains = q.contains(missingId);

        expect(contains).to.be.false;
    });

    fnIt<GasQueue>(g => g.prepend, "lower nonces without replace", () => {
        const lowerItems = [
            createGasQueueItem(1, 1, new BigNumber(110), new BigNumber(110), createIdentifier("data1", "to1")),
            createGasQueueItem(2, 2, new BigNumber(100), new BigNumber(100), createIdentifier("data2", "to2"))
        ];

        const items = [
            createGasQueueItem(3, 3, new BigNumber(90), new BigNumber(90), createIdentifier("data3", "to3")),
            createGasQueueItem(4, 4, new BigNumber(80), new BigNumber(80), createIdentifier("data4", "to4"))
        ];

        const q = new GasQueue(items, 5, 15, 5);
        const uQ = q.prepend(lowerItems);

        const replacedItems = uQ.difference(q);
        expect(replacedItems).to.deep.equal(lowerItems);
    });

    fnIt<GasQueue>(g => g.prepend, "lower nonces without replace", () => {
        const lowerNonceItems = [
            createGasQueueItem(1, 1, new BigNumber(70), new BigNumber(70), createIdentifier("data1", "to1")),
            createGasQueueItem(2, 2, new BigNumber(60), new BigNumber(60), createIdentifier("data2", "to2"))
        ];

        const items = [
            createGasQueueItem(3, 3, new BigNumber(90), new BigNumber(90), createIdentifier("data3", "to3")),
            createGasQueueItem(4, 4, new BigNumber(80), new BigNumber(80), createIdentifier("data4", "to4"))
        ];

        const finalItems = [
            createGasQueueItem(3, 1, new BigNumber(90), new BigNumber(90), createIdentifier("data3", "to3")),
            createGasQueueItem(4, 2, new BigNumber(80), new BigNumber(80), createIdentifier("data4", "to4")),
            createGasQueueItem(1, 3, new BigNumber(70), new BigNumber(99), createIdentifier("data1", "to1")),
            createGasQueueItem(2, 4, new BigNumber(60), new BigNumber(88), createIdentifier("data2", "to2"))
        ];

        const q = new GasQueue(items, 5, 10, 5);
        const uQ = q.prepend(lowerNonceItems);

        const replacedItems = uQ.difference(q);
        expect(replacedItems).to.deep.equal(finalItems);
    });

    fnIt<GasQueue>(g => g.prepend, "does nothing for no items", () => {
        const items = [
            createGasQueueItem(3, 3, new BigNumber(90), new BigNumber(90), createIdentifier("data3", "to3")),
            createGasQueueItem(4, 4, new BigNumber(80), new BigNumber(80), createIdentifier("data4", "to4"))
        ];
        const q = new GasQueue(items, 5, 10, 5);
        const uQ = q.prepend([]);
        expect(uQ.difference(q)).to.deep.equal([]);
    });

    fnIt<GasQueue>(g => g.prepend, "does throw error for missing nonces", () => {
        const unlockItems = [
            createGasQueueItem(1, 1, new BigNumber(110), new BigNumber(110), createIdentifier("data1", "to1"))
        ];

        const items = [
            createGasQueueItem(3, 3, new BigNumber(90), new BigNumber(90), createIdentifier("data3", "to3")),
            createGasQueueItem(4, 4, new BigNumber(80), new BigNumber(80), createIdentifier("data4", "to4"))
        ];

        const q = new GasQueue(items, 5, 15, 5);
        expect(() => q.prepend(unlockItems)).to.throw(ArgumentError);
    });

    fnIt<GasQueue>(g => g.prepend, "does throw error for duplicate nonce", () => {
        const lowerNonceItems = [
            createGasQueueItem(1, 3, new BigNumber(110), new BigNumber(110), createIdentifier("data1", "to1"))
        ];

        const items = [
            createGasQueueItem(3, 3, new BigNumber(90), new BigNumber(90), createIdentifier("data3", "to3")),
            createGasQueueItem(4, 4, new BigNumber(80), new BigNumber(80), createIdentifier("data4", "to4"))
        ];

        const q = new GasQueue(items, 5, 15, 5);
        expect(() => q.prepend(lowerNonceItems)).to.throw(ArgumentError);
    });

    fnIt<GasQueue>(g => g.prepend, "does throw error for nonce too high", () => {
        const lowerNonceItems = [
            createGasQueueItem(1, 5, new BigNumber(110), new BigNumber(110), createIdentifier("data1", "to1"))
        ];

        const items = [
            createGasQueueItem(3, 3, new BigNumber(90), new BigNumber(90), createIdentifier("data3", "to3")),
            createGasQueueItem(4, 4, new BigNumber(80), new BigNumber(80), createIdentifier("data4", "to4"))
        ];

        const q = new GasQueue(items, 5, 15, 5);
        expect(() => q.prepend(lowerNonceItems)).to.throw(ArgumentError);
    });

    fnIt<GasQueue>(() => GasQueue.serialise, "correctly deserialises and serialises", () => {
        const item1 = createGasQueueItem(1, 1, new BigNumber(90), new BigNumber(90), createIdentifier("data1", "to1"));
        const item2 = createGasQueueItem(2, 2, new BigNumber(50), new BigNumber(60), createIdentifier("data2", "to2"));
        const item3 = createGasQueueItem(3, 3, new BigNumber(30), new BigNumber(40), createIdentifier("data3", "to3"));

        const queue = new GasQueue([item1, item2, item3], 4, 12, 10);

        const serialised = GasQueue.serialise(queue);
        const deserialised = GasQueue.deserialise(serialised);

        expect(deserialised).to.deep.equal(queue);
    });
});
