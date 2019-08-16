import "mocha";
import { MultiResponder, GasPriceEstimator, ResponderStore } from "../../../src/responder";
import { ethers } from "ethers";
import { mock, when, anything, spy, verify } from "ts-mockito";
import { BigNumber } from "ethers/utils";
import chai, { expect } from "chai";
import { ArgumentError, Appointment } from "../../../src/dataEntities";
import { PisaTransactionIdentifier, GasQueue } from "../../../src/responder/gasQueue";
import chaiAsPromised from "chai-as-promised";
import fnIt from "../../utils/fnIt";
import throwingInstance from "../../utils/throwingInstance";
import LevelUp from "levelup";
import EncodingDown from "encoding-down";
import MemDown from "memdown";

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

describe("MultiResponder", () => {
    let signer: ethers.Wallet, signerMock: ethers.Wallet;
    let increasingGasPriceEstimator: GasPriceEstimator,
        increasingGasEstimatorMock: GasPriceEstimator,
        decreasingGasPriceEstimator: GasPriceEstimator,
        decreasingGasEstimatorMock: GasPriceEstimator,
        errorGasPriceEstimator: GasPriceEstimator,
        errorGasEstimatorMock: GasPriceEstimator,
        responderStoreMock: ResponderStore,
        store: ResponderStore,
        db: any;

    const maxConcurrentResponses = 3;
    const replacementRate = 15;
    const chainId = 1;

    beforeEach(() => {
        signerMock = mock(ethers.Wallet);
        when(signerMock.address).thenReturn("address");
        when(signerMock.sendTransaction(anything())).thenResolve();
        signer = throwingInstance(signerMock);

        // set up the mocks each time so that we can check the verifies
        decreasingGasEstimatorMock = mock(GasPriceEstimator);
        when(decreasingGasEstimatorMock.estimate(anything())).thenResolve(
            new BigNumber(150),
            new BigNumber(110),
            new BigNumber(100)
        );
        decreasingGasPriceEstimator = throwingInstance(decreasingGasEstimatorMock);

        increasingGasEstimatorMock = mock(GasPriceEstimator);
        when(increasingGasEstimatorMock.estimate(anything())).thenResolve(
            new BigNumber(100),
            new BigNumber(110),
            new BigNumber(150)
        );
        increasingGasPriceEstimator = throwingInstance(increasingGasEstimatorMock);

        errorGasEstimatorMock = mock(GasPriceEstimator);
        when(errorGasEstimatorMock.estimate(anything())).thenThrow(new Error("Gas test error"));
        errorGasPriceEstimator = throwingInstance(errorGasEstimatorMock);

        db = LevelUp(EncodingDown<string, any>(MemDown(), { valueEncoding: "json" }));
        const seedQueue = new GasQueue([], 0, replacementRate, maxConcurrentResponses);
        store = new ResponderStore(db, "address", seedQueue);
        responderStoreMock = spy(store);
    });

    fnIt<MultiResponder>(m => m.startResponse, "can issue transaction", async () => {
        const appointment = createAppointment(1, "data1");

        const responder = new MultiResponder(signer, increasingGasPriceEstimator, chainId, store, signer.address, 500000000000000000);
        await responder.startResponse(appointment);

        verify(responderStoreMock.updateQueue(anything())).once();
        verify(signerMock.sendTransaction(anything())).once();
    });

    fnIt<MultiResponder>(m => m.startResponse, "can issue two transactions and replace", async () => {
        const appointment1 = createAppointment(1, "data1");
        const appointment2 = createAppointment(2, "data2");

        const responder = new MultiResponder(signer, increasingGasPriceEstimator, chainId, store, signer.address, 500000000000000000);

        //const queueBefore = responder.queue;
        await responder.startResponse(appointment1);
        expect(store.transactions.get(appointment1.id)!.request.appointment).to.deep.equal(appointment1);
        verify(responderStoreMock.updateQueue(anything())).once();
        verify(signerMock.sendTransaction(anything())).once();

        // because the gas price is increasing this should result in a replacement
        // therefor two additional transactions are issued, rather than just one
        await responder.startResponse(appointment2);
        expect(store.transactions.get(appointment1.id)!.request.appointment).to.deep.equal(appointment1);
        expect(store.transactions.get(appointment2.id)!.request.appointment).to.deep.equal(appointment2);
        verify(responderStoreMock.updateQueue(anything())).twice();
        verify(signerMock.sendTransaction(anything())).times(3);
    });

    fnIt<MultiResponder>(m => m.startResponse, "can issue two transactions but not replace", async () => {
        const appointment = createAppointment(1, "data1");
        const appointment2 = createAppointment(2, "data2");
        // decreasing
        const responder = new MultiResponder(signer, decreasingGasPriceEstimator, chainId, store, signer.address, 500000000000000000);

        await responder.startResponse(appointment);
        expect(store.transactions.get(appointment.id)!.request.appointment).to.deep.equal(appointment);
        verify(responderStoreMock.updateQueue(anything())).once();
        verify(signerMock.sendTransaction(anything())).once();

        // because the gas price is decreasing this should result not result in a replacement
        // therefore only one new transaction should be issued
        await responder.startResponse(appointment2);
        expect(store.transactions.get(appointment.id)!.request.appointment).to.deep.equal(appointment);
        expect(store.transactions.get(appointment2.id)!.request.appointment).to.deep.equal(appointment2);
        verify(responderStoreMock.updateQueue(anything())).twice();
        verify(signerMock.sendTransaction(anything())).twice();
    });

    fnIt<MultiResponder>(m => m.startResponse, "swallows error", async () => {
        const appointment = createAppointment(1, "data1");
        const responder = new MultiResponder(signer, errorGasPriceEstimator, chainId, store, signer.address, 500000000000000000);

        await responder.startResponse(appointment);
        verify(responderStoreMock.updateQueue(anything())).never();
        verify(signerMock.sendTransaction(anything())).never();
    });

    fnIt<MultiResponder>(m => m.startResponse, "doesn't queue beyond max depth", async () => {
        const appointment = createAppointment(1, "data1");
        const appointment2 = createAppointment(2, "data2");
        const appointment3 = createAppointment(3, "data3");
        const max2Store = new ResponderStore(db, "address", new GasQueue([], 0, replacementRate, 2));
        const max2StoreMock = spy(max2Store);
        const responder = new MultiResponder(signer, decreasingGasPriceEstimator, chainId, max2Store, signer.address, 500000000000000000);

        await responder.startResponse(appointment);
        await responder.startResponse(appointment2);
        expect(max2Store.transactions.size).to.equal(2);
        verify(max2StoreMock.updateQueue(anything())).twice();
        verify(signerMock.sendTransaction(anything())).twice();

        // adding again should do nothing
        await responder.startResponse(appointment3);
        expect(max2Store.transactions.size).to.deep.equal(2);
        verify(max2StoreMock.updateQueue(anything())).twice();
        verify(signerMock.sendTransaction(anything())).twice();
    });

    fnIt<MultiResponder>(m => m.txMined, "does dequeue", async () => {
        const appointment = createAppointment(1, "data1");
        const responder = new MultiResponder(signer, increasingGasPriceEstimator, chainId, store, signer.address, 500000000000000000);

        await responder.startResponse(appointment);
        expect(store.transactions.get(appointment.id)!.request.appointment).to.deep.equal(appointment);
        expect(store.queue.queueItems.length).to.deep.equal(1);
        verify(responderStoreMock.updateQueue(anything())).once();
        verify(signerMock.sendTransaction(anything())).once();
        const item = store.queue.queueItems[0];

        await responder.txMined(item.request.identifier, item.nonce);
        expect(store.transactions.get(appointment.id)!.request.appointment).to.deep.equal(appointment);
        expect(store.queue.queueItems.length).to.deep.equal(0);
        verify(responderStoreMock.updateQueue(anything())).twice();
        verify(signerMock.sendTransaction(anything())).once();
    });

    fnIt<MultiResponder>(m => m.txMined, "does replace", async () => {
        const appointment = createAppointment(1, "data1");
        const appointment2 = createAppointment(2, "data2");
        const responder = new MultiResponder(signer, increasingGasPriceEstimator, chainId, store, signer.address, 500000000000000000);

        await responder.startResponse(appointment);
        const item = store.queue.queueItems[0];

        expect(store.transactions.get(appointment.id)!.request.appointment).to.deep.equal(appointment);
        expect(store.queue.queueItems.length).to.deep.equal(1);
        verify(responderStoreMock.updateQueue(anything())).once();
        verify(signerMock.sendTransaction(anything())).once();

        await responder.startResponse(appointment2);

        expect(store.transactions.get(appointment.id)!.request.appointment).to.deep.equal(appointment);
        expect(store.transactions.get(appointment2.id)!.request.appointment).to.deep.equal(appointment2);
        expect(store.queue.queueItems.length).to.deep.equal(2);
        verify(responderStoreMock.updateQueue(anything())).twice();
        verify(signerMock.sendTransaction(anything())).times(3);

        await responder.txMined(item.request.identifier, item.nonce);

        expect(store.queue.queueItems[0].request.appointment).to.deep.equal(appointment2);
        expect(store.queue.queueItems.length).to.equal(1);
        expect(store.transactions.get(appointment.id)!.request.appointment).to.deep.equal(appointment);
        expect(store.transactions.get(appointment2.id)!.request.appointment).to.deep.equal(appointment2);

        expect(store.queue.queueItems.length).to.deep.equal(1);
        verify(responderStoreMock.updateQueue(anything())).thrice();
        verify(signerMock.sendTransaction(anything())).times(4);
    });

    fnIt<MultiResponder>(m => m.txMined, "does nothing when queue is empty", async () => {
        const responder = new MultiResponder(signer, increasingGasPriceEstimator, chainId, store, signer.address, 500000000000000000);
        const qBefore = store.queue;
        await responder.txMined(new PisaTransactionIdentifier(1, "data", "to", new BigNumber(0), new BigNumber(10)), 1);
        expect(store.queue).to.deep.equal(qBefore)
        expect(store.queue.queueItems.length).to.deep.equal(0);
        verify(responderStoreMock.updateQueue(anything())).never();
        verify(signerMock.sendTransaction(anything())).never();

    });

    fnIt<MultiResponder>(m => m.txMined, "does nothing when item not in queue", async () => {
        const appointment = createAppointment(1, "data1");
        const responder = new MultiResponder(signer, increasingGasPriceEstimator, chainId, store, signer.address, 500000000000000000);

        await responder.startResponse(appointment);
        verify(responderStoreMock.updateQueue(anything())).once();
        verify(signerMock.sendTransaction(anything())).once();

        const queueBefore = store.queue;
        await responder.txMined(new PisaTransactionIdentifier(1, "data", "to", new BigNumber(0), new BigNumber(10)), 1);
        expect(store.queue).to.equal(queueBefore);
        verify(responderStoreMock.updateQueue(anything())).once();
        verify(signerMock.sendTransaction(anything())).once();
    });

    fnIt<MultiResponder>(m => m.txMined, "does nothing nonce is not front of queue", async () => {
        const appointment = createAppointment(1, "data1");
        const responder = new MultiResponder(signer, increasingGasPriceEstimator, chainId, store, signer.address, 500000000000000000);

        await responder.startResponse(appointment);
        verify(responderStoreMock.updateQueue(anything())).once();
        verify(signerMock.sendTransaction(anything())).once();

        const queueBefore = store.queue;
        const item = store.queue.queueItems[0];
        await responder.txMined(item.request.identifier, item.nonce + 1);
        expect(store.queue).to.equal(queueBefore);

    });

    fnIt<MultiResponder>(m => m.reEnqueueMissingItems, "does issue new transactions", async () => {
        const appointment = createAppointment(1, "data1");
        const appointment2 = createAppointment(2, "data2");

        // there are some items that are not in the queue, but are in the multi responder
        // we achieve this by adding the items, the mining them, then insisting they're still in pending
        const responder = new MultiResponder(signer, decreasingGasPriceEstimator, chainId, store, signer.address, 500000000000000000);

        await responder.startResponse(appointment);
        await responder.startResponse(appointment2);
        verify(responderStoreMock.updateQueue(anything())).twice();
        verify(signerMock.sendTransaction(anything())).twice();
        expect(store.queue.queueItems.length).to.equal(2)

        const item = responder.transactions.get(appointment.id)!;
        await responder.txMined(item.request.identifier, item.nonce);
        verify(responderStoreMock.updateQueue(anything())).thrice();
        verify(signerMock.sendTransaction(anything())).twice();
        expect(store.queue.queueItems.length).to.equal(1)

        await responder.reEnqueueMissingItems([appointment.id, appointment2.id]);
        verify(responderStoreMock.updateQueue(anything())).times(4);
        verify(signerMock.sendTransaction(anything())).thrice();
        expect(store.queue.queueItems.length).to.equal(2)
    });

    fnIt<MultiResponder>(m => m.reEnqueueMissingItems, "does replace transactions", async () => {
        // choose a lower gas fee for the first item - this should cause a double replacement
        const appointment = createAppointment(1, "data1");
        const appointment2 = createAppointment(2, "data2");

        const responder = new MultiResponder(signer, increasingGasPriceEstimator, chainId, store, signer.address, 500000000000000000);

        await responder.startResponse(appointment);
        const item = store.transactions.get(appointment.id)!;
        await responder.txMined(item.request.identifier, item.nonce);

        await responder.startResponse(appointment2);
        const item2 = store.transactions.get(appointment2.id)!;
        verify(signerMock.sendTransaction(anything())).twice();

        // should only be one item in the queue
        expect(store.queue.queueItems.length).to.equal(1);

        const queueBefore = store.queue;
        await responder.reEnqueueMissingItems([appointment.id, appointment2.id]);
        const replacedTransactions = store.queue.difference(queueBefore);
        expect(replacedTransactions.length).to.equal(2);
        expect(replacedTransactions[0].request.identifier).to.equal(item2.request.identifier);
        expect(replacedTransactions[0].nonce).to.equal(item.nonce);
        expect(replacedTransactions[1].request.identifier).to.equal(item.request.identifier);
        expect(replacedTransactions[1].nonce).to.equal(item2.nonce);

        verify(signerMock.sendTransaction(anything())).times(4);
    });

    fnIt<MultiResponder>(m => m.reEnqueueMissingItems, "throws error for missing transactions", async () => {
        const appointmentId = "id1";
        const responder = new MultiResponder(signer, decreasingGasPriceEstimator, chainId, store, signer.address, 500000000000000000);

        return expect(responder.reEnqueueMissingItems([appointmentId]))
            .to.eventually.be.rejectedWith(ArgumentError)
    });

    fnIt<MultiResponder>(m => m.reEnqueueMissingItems, "does nothing for no missing transactions", async () => {
        const appointment = createAppointment(1, "data1");
        const appointment2 = createAppointment(2, "data2");
        const responder = new MultiResponder(signer, decreasingGasPriceEstimator, chainId, store, signer.address, 500000000000000000);

        await responder.startResponse(appointment);
        await responder.startResponse(appointment2);

        const item = store.transactions.get(appointment.id)!;
        await responder.txMined(item.request.identifier, item.nonce);

        const queueBefore = store.queue;
        await responder.reEnqueueMissingItems([appointment2.id]);
        const replacedTransactions = store.queue.difference(queueBefore);
        expect(replacedTransactions.length).to.equal(0);

    });

    fnIt<MultiResponder>(m => m.endResponse, "removes item from transactions", async () => {
        const appointment = createAppointment(1, "data1");
        const responder = new MultiResponder(signer, decreasingGasPriceEstimator, chainId, store, signer.address, 500000000000000000);

        await responder.startResponse(appointment);        
        expect(store.transactions.has(appointment.id)).to.be.true;

        await responder.endResponse(appointment.id);
        expect(store.transactions.has(appointment.id)).to.be.false;
        verify(responderStoreMock.removeResponse(anything())).once();
    });
});
