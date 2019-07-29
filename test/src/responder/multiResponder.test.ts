import "mocha";
import { MultiResponder, GasPriceEstimator } from "../../../src/responder";
import { ethers } from "ethers";
import { mock, when, anything, instance } from "ts-mockito";
import { BigNumber } from "ethers/utils";
import chai, { expect } from "chai";
import { ArgumentError, Appointment } from "../../../src/dataEntities";
import { PisaTransactionIdentifier } from "../../../src/responder/gasQueue";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);

const createAppointment = (id: number, data: string): Appointment => {
    return Appointment.fromIAppointment({
        challengePeriod: 10,
        contractAddress: "contractAddress",
        customerAddress: "customerAddress",
        data,
        endBlock: 10,
        eventABI: "eventABI",
        eventArgs: "eventArgs",
        gas: 100,
        customerChosenId: id,
        jobId: 1,
        mode: 1,
        paymentHash: "paymentHash",
        postCondition: "postCondition",
        refund: 3,
        startBlock: 7
    });
};

describe("MultiResponder", () => {
    let signer: ethers.Signer;
    let increasingGasPriceEstimator: GasPriceEstimator,
        increasingGasEstimatorMock: GasPriceEstimator,
        decreasingGasPriceEstimator: GasPriceEstimator,
        decreasingGasEstimatorMock: GasPriceEstimator,
        errorGasPriceEstimator: GasPriceEstimator,
        errorGasEstimatorMock: GasPriceEstimator;
    const maxConcurrentResponses = 3;
    const replacementRate = 15;

    beforeEach(() => {
        const providerMock = mock(ethers.providers.JsonRpcProvider);
        when(providerMock.getNetwork()).thenResolve({ chainId: 1 , name: "test"})
        when(providerMock.getTransactionCount("address", "pending")).thenResolve(1)
        const provider = instance(providerMock);

        const signerMock = mock(ethers.providers.JsonRpcSigner);
        when(signerMock.getAddress()).thenResolve("address");
        when(signerMock.provider).thenReturn(provider);
        signer = instance(signerMock);

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
        const appointment = createAppointment(1, "data1");

        const responder = new MultiResponder(
            signer,
            increasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );
        await responder.start();

        const queueBefore = responder.queue;
        await responder.startResponse(appointment);
        const issuedTransactions = responder.queue.difference(queueBefore);

        expect(responder.respondedTransactions.get(appointment.id)).to.not.be.empty;
        expect(issuedTransactions.length).to.equal(1);

        await responder.stop();
    });

    it("startResponse can issue two transactions and replace", async () => {
        const appointment1 = createAppointment(1, "data1");
        const appointment2 = createAppointment(2, "data2");

        const responder = new MultiResponder(
            signer,
            increasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );

        await responder.start();

        const queueBefore = responder.queue;
        await responder.startResponse(appointment1);
        const issuedTransactions = responder.queue.difference(queueBefore);
        expect(responder.respondedTransactions.get(appointment1.id)!.request.appointment).to.deep.equal(appointment1);
        expect(issuedTransactions.length).to.equal(1);
        // because the gas price is increasing this should result in a replacement
        // therefor two additional transactions are issued, rather than just one
        const queueBefore2 = responder.queue;
        await responder.startResponse(appointment2);
        const issuedTransactions2 = responder.queue.difference(queueBefore2);
        expect(responder.respondedTransactions.get(appointment1.id)!.request.appointment).to.deep.equal(appointment1);
        expect(responder.respondedTransactions.get(appointment2.id)!.request.appointment).to.deep.equal(appointment2);
        expect(issuedTransactions2.length).to.equal(2);

        await responder.stop();
    });

    it("startResponse can issue two transactions but not replace", async () => {
        const appointment = createAppointment(1, "data1");
        const appointment2 = createAppointment(2, "data2");

        const responder = new MultiResponder(
            signer,
            // decreasing
            decreasingGasPriceEstimator,

            maxConcurrentResponses,
            replacementRate
        );

        await responder.start();

        const queueBefore = responder.queue;
        await responder.startResponse(appointment);
        const issuedTransactions = responder.queue.difference(queueBefore);
        expect(responder.respondedTransactions.get(appointment.id)).to.not.be.empty;
        expect(issuedTransactions.length).to.equal(1);

        // because the gas price is decreasing this should result not result in a replacement
        // therefore only one new transaction should be issued
        const queueBefore2 = responder.queue;
        await responder.startResponse(appointment2);
        const issuedTransactions2 = responder.queue.difference(queueBefore2);
        expect(responder.respondedTransactions.get(appointment.id)).to.not.be.empty;
        expect(responder.respondedTransactions.get(appointment2.id)).to.not.be.empty;
        expect(issuedTransactions2.length).to.equal(1);

        await responder.stop();
    });

    it("startResponse swallows error", async () => {
        const appointment = createAppointment(1, "data1");
        const responder = new MultiResponder(
            signer,
            errorGasPriceEstimator,

            maxConcurrentResponses,
            replacementRate
        );
        await responder.start();

        await responder.startResponse(appointment);
        expect(responder.respondedTransactions.size).to.be.equal(0);

        await responder.stop();
    });

    it("startResponse doesnt queue beyond max depth", async () => {
        const appointment = createAppointment(1, "data1");
        const appointment2 = createAppointment(2, "data2");
        const appointment3 = createAppointment(3, "data3");

        const responder = new MultiResponder(signer, decreasingGasPriceEstimator, 2, replacementRate);

        await responder.start();

        const queueBefore = responder.queue;
        await responder.startResponse(appointment);
        await responder.startResponse(appointment2);
        const issuedTransactions = responder.queue.difference(queueBefore);
        expect(responder.respondedTransactions.size).to.equal(2);
        expect(issuedTransactions.length).to.equal(2);

        // adding again should do nothing
        const queueBefore2 = responder.queue;
        await responder.startResponse(appointment3);
        const issuedTransactions2 = responder.queue.difference(queueBefore2);
        expect(responder.respondedTransactions.size).to.equal(2);
        expect(issuedTransactions2.length).to.equal(0);

        await responder.stop();
    });

    it("txMined does dequeue", async () => {
        const appointment = createAppointment(1, "data1");
        const responder = new MultiResponder(
            signer,
            increasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );

        await responder.start();

        await responder.startResponse(appointment);
        const item = responder.queue.queueItems[0];

        await responder.txMined(item.request.identifier, item.nonce);
        expect(responder.queue.queueItems.length).to.equal(0);

        await responder.stop();
    });

    it("txMined does replace", async () => {
        const appointment = createAppointment(1, "data1");
        const appointment2 = createAppointment(2, "data2");
        const responder = new MultiResponder(
            signer,
            increasingGasPriceEstimator,

            maxConcurrentResponses,
            replacementRate
        );

        await responder.start();

        await responder.startResponse(appointment);
        const item = responder.queue.queueItems[0];

        await responder.startResponse(appointment2);
        const itemAfterReplace = responder.queue.queueItems[0];

        const queueBefore = responder.queue;
        await responder.txMined(item.request.identifier, item.nonce);
        const issuedTransactions = responder.queue.difference(queueBefore);
        expect(responder.respondedTransactions.size).to.equal(2);
        expect(issuedTransactions.length).to.equal(1);
        const itemAfterMined = responder.queue.queueItems[0];

        expect(responder.queue.queueItems.length).to.equal(1);
        expect(itemAfterMined.request.identifier).to.deep.equal(itemAfterReplace.request.identifier);
        expect(itemAfterMined.nonce).to.equal(itemAfterReplace.nonce + 1);
        await responder.stop();
    });

    it("txMined does nothing when queue is empty", async () => {
        const responder = new MultiResponder(
            signer,
            increasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );

        await responder.start();

        const queueBefore = responder.queue;
        await responder.txMined(new PisaTransactionIdentifier(1, "data", "to", new BigNumber(0), new BigNumber(10)), 1);
        expect(responder.queue).to.equal(queueBefore);

        await responder.stop();
    });

    it("txMined does nothing when item not in queue", async () => {
        const appointment = createAppointment(1, "data1");
        const responder = new MultiResponder(
            signer,
            increasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );
        await responder.start();
        await responder.startResponse(appointment);
        const queueBefore = responder.queue;
        await responder.txMined(new PisaTransactionIdentifier(1, "data", "to", new BigNumber(0), new BigNumber(10)), 1);
        expect(responder.queue).to.equal(queueBefore);

        await responder.stop();
    });

    it("txMined does nothing nonce is not front of queue", async () => {
        const appointment = createAppointment(1, "data1");
        const responder = new MultiResponder(
            signer,
            increasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );

        await responder.start();
        await responder.startResponse(appointment);
        const queueBefore = responder.queue;
        const item = responder.queue.queueItems[0];
        await responder.txMined(item.request.identifier, item.nonce + 1);

        expect(responder.queue).to.equal(queueBefore);

        await responder.stop();
    });

    it("reEnqueueMissingItems does issue new transactions", async () => {
        const appointment = createAppointment(1, "data1");
        const appointment2 = createAppointment(2, "data2");

        // there are some items that are not in the queue, but are in the multi responder
        // we achieve this by adding the items, the mining them, then insisting they're still in pending

        const responder = new MultiResponder(
            signer,
            decreasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );
        await responder.start();
        await responder.startResponse(appointment);
        await responder.startResponse(appointment2);

        const item = responder.respondedTransactions.get(appointment.id)!;
        await responder.txMined(item.request.identifier, item.nonce);

        const queueBefore = responder.queue;
        await responder.reEnqueueMissingItems([appointment.id, appointment2.id]);
        const replacedTransactions = responder.queue.difference(queueBefore);
        expect(replacedTransactions.length).to.equal(1);
        expect(replacedTransactions[0].request.identifier).to.equal(item.request.identifier);
        expect(replacedTransactions[0].nonce).to.equal(item.nonce);

        await responder.stop();
    });

    it("reEnqueueMissingItems does replace transactions", async () => {
        // choose a lower gas fee for the first item - this should cause a double replacement
        const appointment = createAppointment(1, "data1");
        const appointment2 = createAppointment(2, "data2");

        const responder = new MultiResponder(
            signer,
            increasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );
        await responder.start();
        await responder.startResponse(appointment);
        const item = responder.respondedTransactions.get(appointment.id)!;
        await responder.txMined(item.request.identifier, item.nonce);

        await responder.startResponse(appointment2);
        const item2 = responder.respondedTransactions.get(appointment2.id)!;

        // should only be one item in the queue
        expect(responder.queue.queueItems.length).to.equal(1);

        const queueBefore = responder.queue;
        await responder.reEnqueueMissingItems([appointment.id, appointment2.id]);
        const replacedTransactions = responder.queue.difference(queueBefore);
        expect(replacedTransactions.length).to.equal(2);
        expect(replacedTransactions[0].request.identifier).to.equal(item2.request.identifier);
        expect(replacedTransactions[0].nonce).to.equal(item.nonce);
        expect(replacedTransactions[1].request.identifier).to.equal(item.request.identifier);
        expect(replacedTransactions[1].nonce).to.equal(item2.nonce);

        await responder.stop();
    });

    it("reEnqueueMissingItems throws error for missing transactions", async () => {
        const appointmentId = "id1";
        const responder = new MultiResponder(
            signer,
            decreasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );
        await responder.start();

        return expect(responder.reEnqueueMissingItems([appointmentId]))
            .to.eventually.be.rejectedWith(ArgumentError)
            .then(async () => await responder.stop());
    });

    it("reEnqueueMissingItems does nothing for no missing transactions", async () => {
        const appointment = createAppointment(1, "data1");
        const appointment2 = createAppointment(2, "data2");

        const responder = new MultiResponder(
            signer,
            decreasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );
        await responder.start();
        await responder.startResponse(appointment);
        await responder.startResponse(appointment2);

        const item = responder.respondedTransactions.get(appointment.id)!;
        await responder.txMined(item.request.identifier, item.nonce);

        const queueBefore = responder.queue;
        await responder.reEnqueueMissingItems([appointment2.id]);
        const replacedTransactions = responder.queue.difference(queueBefore);
        expect(replacedTransactions.length).to.equal(0);

        await responder.stop();
    });

    it("endResponse removes item from transactions", async () => {
        const appointment = createAppointment(1, "data1");
        const responder = new MultiResponder(
            signer,
            decreasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );
        await responder.start();
        await responder.startResponse(appointment);
        expect(responder.respondedTransactions.has(appointment.id)).to.be.true;
        await responder.endResponse(appointment.id);
        expect(responder.respondedTransactions.has(appointment.id)).to.be.false;
        await responder.stop();
    });
});
