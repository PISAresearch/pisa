import "mocha";
import { MultiResponder, GasPriceEstimator } from "../../../src/responder";
import Ganache from "ganache-core";
import { ethers } from "ethers";
import { mock, when, anything, instance } from "ts-mockito";
import { BigNumber } from "ethers/utils";
import chai, { expect } from "chai";
import { ArgumentError, IEthereumResponseData, Block } from "../../../src/dataEntities";
import { PisaTransactionIdentifier } from "../../../src/responder/gasQueue";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);

const ganache = Ganache.provider({
    mnemonic: "myth like bonus scare over problem client lizard pioneer submit female collect"
});

const createResponseData = (data: string): IEthereumResponseData => {
    return {
        contractAbi: ["function setValue(string value)"],
        contractAddress: "0x2bD9aAa2953F988153c8629926D22A6a5F69b14E",
        endBlock: 10,
        functionArgs: [data],
        functionName: "setValue"
    };
};

describe("MultiResponder", () => {
    const provider = new ethers.providers.Web3Provider(ganache);
    const signer = provider.getSigner(0);

    let increasingGasPriceEstimator: GasPriceEstimator,
        increasingGasEstimatorMock: GasPriceEstimator,
        decreasingGasPriceEstimator: GasPriceEstimator,
        decreasingGasEstimatorMock: GasPriceEstimator,
        errorGasPriceEstimator: GasPriceEstimator,
        errorGasEstimatorMock: GasPriceEstimator;
    const maxConcurrentResponses = 3;
    const replacementRate = 15;

    let address: string;

    before(async () => {
        address = await signer.getAddress();
    });

    beforeEach(() => {
        // set up the mocks each time so that we can check the verifies
        decreasingGasEstimatorMock = mock(GasPriceEstimator);
        when(decreasingGasEstimatorMock.estimate(anything())).thenResolve(
            new BigNumber(150),
            new BigNumber(110),
            new BigNumber(100)
        );
        decreasingGasPriceEstimator = instance(decreasingGasEstimatorMock);

        increasingGasEstimatorMock = mock(GasPriceEstimator);
        when(increasingGasEstimatorMock.estimate(anything())).thenResolve(
            new BigNumber(100),
            new BigNumber(110),
            new BigNumber(150)
        );
        increasingGasPriceEstimator = instance(increasingGasEstimatorMock);

        errorGasEstimatorMock = mock(GasPriceEstimator);
        when(errorGasEstimatorMock.estimate(anything())).thenThrow(new Error("Gas test error"));
        errorGasPriceEstimator = instance(errorGasEstimatorMock);
    });

    it("constructor throws for negative replacement rate", async () => {
        expect(() => new MultiResponder(signer, increasingGasPriceEstimator, maxConcurrentResponses, -1)).to.throw(
            ArgumentError
        );
    });

    it("constructor throws for zero max concurrency", async () => {
        expect(() => new MultiResponder(signer, increasingGasPriceEstimator, 0, replacementRate)).to.throw(
            ArgumentError
        );
    });

    it("startResponse can issue transaction", async () => {
        const appointmentId = "app1";
        const responseData = createResponseData("app1");

        const responder = new MultiResponder(
            signer,
            increasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );
        await responder.start();

        const queueBefore = responder.queue;
        await responder.startResponse(appointmentId, responseData);
        const issuedTransactions = responder.queue.difference(queueBefore);

        expect(responder.respondedTransactions.get(appointmentId)).to.not.be.empty;
        expect(issuedTransactions.length).to.equal(1);

        await responder.stop();
    });

    it("startResponse can issue two transactions and replace", async () => {
        const appointmentId = "app1";
        const responseData = createResponseData("app1");
        const appointmentId2 = "app2";
        const responseData2 = createResponseData("app2");

        const responder = new MultiResponder(
            signer,
            increasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );

        await responder.start();

        const queueBefore = responder.queue;
        await responder.startResponse(appointmentId, responseData);
        const issuedTransactions = responder.queue.difference(queueBefore);
        expect(responder.respondedTransactions.get(appointmentId)).to.not.be.empty;
        expect(issuedTransactions.length).to.equal(1);
        // because the gas price is increasing this should result in a replacement
        // therefor two additional transactions are issued, rather than just one
        const queueBefore2 = responder.queue;
        await responder.startResponse(appointmentId2, responseData2);
        const issuedTransactions2 = responder.queue.difference(queueBefore2);
        expect(responder.respondedTransactions.get(appointmentId)).to.not.be.empty;
        expect(responder.respondedTransactions.get(appointmentId2)).to.not.be.empty;
        expect(issuedTransactions2.length).to.equal(2);

        await responder.stop();
    });

    it("startResponse can issue two transactions but not replace", async () => {
        const appointmentId = "app1";
        const responseData = createResponseData("app1");
        const appointmentId2 = "app2";
        const responseData2 = createResponseData("app2");

        const responder = new MultiResponder(
            signer,
            // decreasing
            decreasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );

        await responder.start();

        const queueBefore = responder.queue;
        await responder.startResponse(appointmentId, responseData);
        const issuedTransactions = responder.queue.difference(queueBefore);
        expect(responder.respondedTransactions.get(appointmentId)).to.not.be.empty;
        expect(issuedTransactions.length).to.equal(1);

        // because the gas price is decreasing this should result not result in a replacement
        // therefore only one new transaction should be issued
        const queueBefore2 = responder.queue;
        await responder.startResponse(appointmentId2, responseData2);
        const issuedTransactions2 = responder.queue.difference(queueBefore2);
        expect(responder.respondedTransactions.get(appointmentId)).to.not.be.empty;
        expect(responder.respondedTransactions.get(appointmentId2)).to.not.be.empty;
        expect(issuedTransactions2.length).to.equal(1);

        await responder.stop();
    });

    it("startResponse swallows error", async () => {
        const appointmentId = "app1";
        const responseData = createResponseData("app1");
        const responder = new MultiResponder(signer, errorGasPriceEstimator, maxConcurrentResponses, replacementRate);
        await responder.start();

        await responder.startResponse(appointmentId, responseData);
        expect(responder.respondedTransactions.size).to.be.equal(0);

        await responder.stop();
    });

    it("startResponse doesnt queue beyond max depth", async () => {
        const appointmentId = "app1";
        const responseData = createResponseData("app1");
        const appointmentId2 = "app2";
        const responseData2 = createResponseData("app2");
        const appointmentId3 = "app3";
        const responseData3 = createResponseData("app3");

        const responder = new MultiResponder(signer, decreasingGasPriceEstimator, 2, replacementRate);

        await responder.start();

        const queueBefore = responder.queue;
        await responder.startResponse(appointmentId, responseData);
        await responder.startResponse(appointmentId2, responseData2);
        const issuedTransactions = responder.queue.difference(queueBefore);
        expect(responder.respondedTransactions.size).to.equal(2);
        expect(issuedTransactions.length).to.equal(2);

        // adding again should do nothing
        const queueBefore2 = responder.queue;
        await responder.startResponse(appointmentId3, responseData3);
        const issuedTransactions2 = responder.queue.difference(queueBefore2);
        expect(responder.respondedTransactions.size).to.equal(2);
        expect(issuedTransactions2.length).to.equal(0);

        await responder.stop();
    });

    it("txMined does dequeue", async () => {
        const appointmentId = "app1";
        const responseData = createResponseData("app1");
        const responder = new MultiResponder(
            signer,
            increasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );

        await responder.start();

        await responder.startResponse(appointmentId, responseData);
        const item = responder.queue.queueItems[0];

        await responder.txMined(item.request.identifier, item.nonce, address);
        expect(responder.queue.queueItems.length).to.equal(0);

        await responder.stop();
    });

    it("txMined does replace", async () => {
        const appointmentId = "app1";
        const responseData = createResponseData("app1");
        const appointmentId2 = "app2";
        const responseData2 = createResponseData("app2");
        const responder = new MultiResponder(
            signer,
            increasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );

        await responder.start();

        await responder.startResponse(appointmentId, responseData);
        const item = responder.queue.queueItems[0];

        await responder.startResponse(appointmentId2, responseData2);
        const itemAfterReplace = responder.queue.queueItems[0];

        const queueBefore = responder.queue;
        await responder.txMined(item.request.identifier, item.nonce, address);
        const issuedTransactions = responder.queue.difference(queueBefore);
        expect(responder.respondedTransactions.size).to.equal(2);
        expect(issuedTransactions.length).to.equal(1);
        const itemAfterMined = responder.queue.queueItems[0];

        expect(responder.queue.queueItems.length).to.equal(1);
        expect(itemAfterMined.request.identifier).to.deep.equal(itemAfterReplace.request.identifier);
        expect(itemAfterMined.nonce).to.equal(itemAfterReplace.nonce + 1);
        await responder.stop();
    });

    it("txMined does nothing when from does not equal responder address", async () => {
        const appointmentId = "app1";
        const responseData = createResponseData("app1");
        const differentAddress = "different address"
        const responder = new MultiResponder(
            signer,
            increasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );

        await responder.start();

        await responder.startResponse(appointmentId, responseData);
        const item = responder.queue.queueItems[0];

        const queueBefore = responder.queue;
        await responder.txMined(item.request.identifier, item.nonce, differentAddress);
        expect(responder.queue).to.equal(queueBefore);

        await responder.stop();
    })

    it("txMined does nothing when queue is empty", async () => {
        const responder = new MultiResponder(
            signer,
            increasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );

        await responder.start();

        const queueBefore = responder.queue;
        await responder.txMined(
            new PisaTransactionIdentifier(1, "data", "to", new BigNumber(0), new BigNumber(10)),
            1,
            address
        );
        expect(responder.queue).to.equal(queueBefore);

        await responder.stop();
    });

    it("txMined does nothing when item not in queue", async () => {
        const appointmentId = "app1";
        const responseData = createResponseData("app1");
        const responder = new MultiResponder(
            signer,
            increasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );
        await responder.start();
        await responder.startResponse(appointmentId, responseData);
        const queueBefore = responder.queue;
        await responder.txMined(
            new PisaTransactionIdentifier(1, "data", "to", new BigNumber(0), new BigNumber(10)),
            1,
            address
        );
        expect(responder.queue).to.equal(queueBefore);

        await responder.stop();
    });

    it("txMined does nothing nonce is not front of queue", async () => {
        const appointmentId = "app1";
        const responseData = createResponseData("app1");
        const responder = new MultiResponder(
            signer,
            increasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );

        await responder.start();
        await responder.startResponse(appointmentId, responseData);
        const queueBefore = responder.queue;
        const item = responder.queue.queueItems[0];
        await responder.txMined(item.request.identifier, item.nonce + 1, address);

        expect(responder.queue).to.equal(queueBefore);

        await responder.stop();
    });

    it("reEnqueueMissingItems does issue new transactions", async () => {
        const appointmentId = "app1";
        const responseData = createResponseData("app1");
        const appointmentId2 = "app2";
        const responseData2 = createResponseData("app2");

        // there are some items that are not in the queue, but are in the multi responder
        // we achieve this by adding the items, the mining them, then insisting they're still in pending

        const responder = new MultiResponder(
            signer,
            decreasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );
        await responder.start();
        await responder.startResponse(appointmentId, responseData);
        await responder.startResponse(appointmentId2, responseData2);

        const item = responder.respondedTransactions.get(appointmentId)!.queueItem;
        await responder.txMined(item.request.identifier, item.nonce, address);

        const queueBefore = responder.queue;
        await responder.reEnqueueMissingItems([appointmentId, appointmentId2]);
        const replacedTransactions = responder.queue.difference(queueBefore);
        expect(replacedTransactions.length).to.equal(1);
        expect(replacedTransactions[0].request.identifier).to.equal(item.request.identifier);
        expect(replacedTransactions[0].nonce).to.equal(item.nonce);

        await responder.stop();
    });

    it("reEnqueueMissingItems does replace transactions", async () => {
        const appointmentId = "app1";
        // choose a lower gas fee for the first item - this should cause a double replacement
        const responseData = createResponseData("app1");
        const appointmentId2 = "app2";
        const responseData2 = createResponseData("app2");

        const responder = new MultiResponder(
            signer,
            increasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );
        await responder.start();
        await responder.startResponse(appointmentId, responseData);
        const item = responder.respondedTransactions.get(appointmentId)!.queueItem;
        await responder.txMined(item.request.identifier, item.nonce, address);

        await responder.startResponse(appointmentId2, responseData2);
        const item2 = responder.respondedTransactions.get(appointmentId2)!.queueItem;

        // should only be one item in the queue
        expect(responder.queue.queueItems.length).to.equal(1);

        const queueBefore = responder.queue;
        await responder.reEnqueueMissingItems([appointmentId, appointmentId2]);
        const replacedTransactions = responder.queue.difference(queueBefore);
        expect(replacedTransactions.length).to.equal(2);
        expect(replacedTransactions[0].request.identifier).to.equal(item2.request.identifier);
        expect(replacedTransactions[0].nonce).to.equal(item.nonce);
        expect(replacedTransactions[1].request.identifier).to.equal(item.request.identifier);
        expect(replacedTransactions[1].nonce).to.equal(item2.nonce);

        await responder.stop();
    });

    it("reEnqueueMissingItems throws error for missing transactions", async () => {
        const appointmentId = "app1";
        const responder = new MultiResponder(
            signer,
            decreasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );
        await responder.start();

        expect(responder.reEnqueueMissingItems([appointmentId])).to.eventually.be.rejectedWith(ArgumentError);

        await responder.stop();
    });

    it("reEnqueueMissingItems does nothing for no missing transactions", async () => {
        const appointmentId = "app1";
        const responseData = createResponseData("app1");
        const appointmentId2 = "app2";
        const responseData2 = createResponseData("app2");

        const responder = new MultiResponder(
            signer,
            decreasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );
        await responder.start();
        await responder.startResponse(appointmentId, responseData);
        await responder.startResponse(appointmentId2, responseData2);

        const item = responder.respondedTransactions.get(appointmentId)!.queueItem;
        await responder.txMined(item.request.identifier, item.nonce, address);

        const queueBefore = responder.queue;
        await responder.reEnqueueMissingItems([appointmentId2]);
        const replacedTransactions = responder.queue.difference(queueBefore);
        expect(replacedTransactions.length).to.equal(0);

        await responder.stop();
    });

    it("endResponse removes item from transactions", async () => {
        const appointmentId = "app1";
        const responseData = createResponseData("app1");
        const responder = new MultiResponder(
            signer,
            decreasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );
        await responder.start();
        await responder.startResponse(appointmentId, responseData);
        expect(responder.respondedTransactions.has(appointmentId)).to.be.true;
        await responder.endResponse(appointmentId);
        expect(responder.respondedTransactions.has(appointmentId)).to.be.false;
        await responder.stop();
    });
});
