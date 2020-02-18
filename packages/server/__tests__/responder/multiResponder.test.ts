import "mocha";
import { mock, when, anything, spy, verify } from "ts-mockito";
import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";

import LevelUp from "levelup";
import EncodingDown from "encoding-down";
import MemDown from "memdown";
import { ethers } from "ethers";
import { BigNumber } from "ethers/utils";

import { fnIt, throwingInstance } from "@pisa-research/test-utils";
import { ArgumentError } from "@pisa-research/errors";
import { DbObject } from "@pisa-research/utils";

import { PisaTransactionIdentifier, GasQueue } from "../../src/responder/gasQueue";
import { MultiResponder, GasPriceEstimator, ResponderStore } from "../../src/responder";

chai.use(chaiAsPromised);

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
    const pisaContractAddress = "0x3deA9963BF4c1a3716025dE8AE05a5caC66db46E";
    const gasLimit = 137;
    const startBlock = 7;
    const endBlock = startBlock + 100;

    const id1 = "1";
    const id2 = "2";
    const id3 = "3";
    const data1 = "data1";
    const data2 = "data2";
    const data3 = "data3";

    beforeEach(() => {
        signerMock = mock(ethers.Wallet);
        when(signerMock.address).thenReturn("address");
        when(signerMock.sendTransaction(anything())).thenResolve();
        signer = throwingInstance(signerMock);

        // set up the mocks each time so that we can check the verifies
        decreasingGasEstimatorMock = mock(GasPriceEstimator);
        when(decreasingGasEstimatorMock.estimate(anything())).thenResolve(new BigNumber(150), new BigNumber(110), new BigNumber(100));
        decreasingGasPriceEstimator = throwingInstance(decreasingGasEstimatorMock);

        increasingGasEstimatorMock = mock(GasPriceEstimator);
        when(increasingGasEstimatorMock.estimate(anything())).thenResolve(new BigNumber(100), new BigNumber(110), new BigNumber(150));
        increasingGasPriceEstimator = throwingInstance(increasingGasEstimatorMock);

        errorGasEstimatorMock = mock(GasPriceEstimator);
        when(errorGasEstimatorMock.estimate(anything())).thenThrow(new Error("Gas test error"));
        errorGasPriceEstimator = throwingInstance(errorGasEstimatorMock);

        db = LevelUp(EncodingDown<string, DbObject>(MemDown(), { valueEncoding: "json" }));
        const seedQueue = new GasQueue([], 0, replacementRate, maxConcurrentResponses);
        store = new ResponderStore(db, "address", seedQueue);
        responderStoreMock = spy(store);
    });

    const createResponder = (gasPriceEstimator: GasPriceEstimator) => {
        return new MultiResponder(signer, gasPriceEstimator, chainId, store, signer.address, new BigNumber("500000000000000000"), pisaContractAddress);
    };

    fnIt<MultiResponder>(m => m.startResponse, "can issue transaction", async () => {
        const responder = createResponder(increasingGasPriceEstimator);
        await responder.startResponse(pisaContractAddress, data1, gasLimit, id1, startBlock, endBlock);

        verify(responderStoreMock.updateQueue(anything())).once();
        verify(signerMock.sendTransaction(anything())).once();
    });

    fnIt<MultiResponder>(m => m.startResponse, "can issue two transactions and replace", async () => {
        const responder = createResponder(increasingGasPriceEstimator);
        await responder.startResponse(pisaContractAddress, data1, gasLimit, id1, startBlock, endBlock);
        expect(store.transactions.get(id1)!.request.id).to.deep.equal(id1);
        verify(responderStoreMock.updateQueue(anything())).once();
        verify(signerMock.sendTransaction(anything())).once();

        // because the gas price is increasing this should result in a replacement
        // therefor two additional transactions are issued, rather than just one
        await responder.startResponse(pisaContractAddress, data2, gasLimit, id2, startBlock, endBlock);
        expect(store.transactions.get(id1)!.request.id).to.deep.equal(id1);
        expect(store.transactions.get(id2)!.request.id).to.deep.equal(id2);
        verify(responderStoreMock.updateQueue(anything())).twice();
        verify(signerMock.sendTransaction(anything())).times(3);
    });

    fnIt<MultiResponder>(m => m.startResponse, "can issue two transactions but not replace", async () => {
        // decreasing
        const responder = createResponder(decreasingGasPriceEstimator);

        await responder.startResponse(pisaContractAddress, data1, gasLimit, id1, startBlock, endBlock);
        expect(store.transactions.get(id1)!.request.id).to.deep.equal(id1);
        verify(responderStoreMock.updateQueue(anything())).once();
        verify(signerMock.sendTransaction(anything())).once();

        // because the gas price is decreasing this should result not result in a replacement
        // therefore only one new transaction should be issued
        await responder.startResponse(pisaContractAddress, data2, gasLimit, id2, startBlock, endBlock);
        expect(store.transactions.get(id1)!.request.id).to.deep.equal(id1);
        expect(store.transactions.get(id2)!.request.id).to.deep.equal(id2);
        verify(responderStoreMock.updateQueue(anything())).twice();
        verify(signerMock.sendTransaction(anything())).twice();
    });

    fnIt<MultiResponder>(m => m.startResponse, "swallows error", async () => {
        const responder = createResponder(errorGasPriceEstimator);

        await responder.startResponse(pisaContractAddress, data1, gasLimit, id1, startBlock, endBlock);
        verify(responderStoreMock.updateQueue(anything())).never();
        verify(signerMock.sendTransaction(anything())).never();
    });

    fnIt<MultiResponder>(m => m.startResponse, "doesn't queue beyond max depth", async () => {
        const max2Store = new ResponderStore(db, "address", new GasQueue([], 0, replacementRate, 2));
        const max2StoreMock = spy(max2Store);
        const responder = new MultiResponder(
            signer,
            decreasingGasPriceEstimator,
            chainId,
            max2Store,
            signer.address,
            new BigNumber("500000000000000000"),
            pisaContractAddress
        );
        await responder.startResponse(pisaContractAddress, data1, gasLimit, id1, startBlock, endBlock);
        await responder.startResponse(pisaContractAddress, data2, gasLimit, id2, startBlock, endBlock);
        expect(max2Store.transactions.size).to.equal(2);
        verify(max2StoreMock.updateQueue(anything())).twice();
        verify(signerMock.sendTransaction(anything())).twice();

        // adding again should do nothing
        await responder.startResponse(pisaContractAddress, data3, gasLimit, id3, startBlock, endBlock);
        expect(max2Store.transactions.size).to.deep.equal(2);
        verify(max2StoreMock.updateQueue(anything())).twice();
        verify(signerMock.sendTransaction(anything())).twice();
    });

    fnIt<MultiResponder>(m => m.txMined, "does dequeue", async () => {
        const responder = createResponder(increasingGasPriceEstimator);

        await responder.startResponse(pisaContractAddress, data1, gasLimit, id1, startBlock, endBlock);
        expect(store.transactions.get(id1)!.request.id).to.deep.equal(id1);
        expect(store.queue.queueItems.length).to.deep.equal(1);
        verify(responderStoreMock.updateQueue(anything())).once();
        verify(signerMock.sendTransaction(anything())).once();
        const item = store.queue.queueItems[0];

        await responder.txMined(item.request.identifier, item.nonce);
        expect(store.transactions.get(id1)!.request.id).to.deep.equal(id1);
        expect(store.queue.queueItems.length).to.deep.equal(0);
        verify(responderStoreMock.updateQueue(anything())).twice();
        verify(signerMock.sendTransaction(anything())).once();
    });

    fnIt<MultiResponder>(m => m.txMined, "does replace", async () => {
        const responder = createResponder(increasingGasPriceEstimator);

        await responder.startResponse(pisaContractAddress, data1, gasLimit, id1, startBlock, endBlock);
        const item = store.queue.queueItems[0];

        expect(store.transactions.get(id1)!.request.id).to.deep.equal(id1);
        expect(store.queue.queueItems.length).to.deep.equal(1);
        verify(responderStoreMock.updateQueue(anything())).once();
        verify(signerMock.sendTransaction(anything())).once();

        await responder.startResponse(pisaContractAddress, data2, gasLimit, id2, startBlock, endBlock);

        expect(store.transactions.get(id1)!.request.id).to.deep.equal(id1);
        expect(store.transactions.get(id2)!.request.id).to.deep.equal(id2);
        expect(store.queue.queueItems.length).to.deep.equal(2);
        verify(responderStoreMock.updateQueue(anything())).twice();
        verify(signerMock.sendTransaction(anything())).times(3);

        await responder.txMined(item.request.identifier, item.nonce);

        expect(store.queue.queueItems[0].request.id).to.deep.equal(id2);
        expect(store.queue.queueItems.length).to.equal(1);
        expect(store.transactions.get(id1)!.request.id).to.deep.equal(id1);
        expect(store.transactions.get(id2)!.request.id).to.deep.equal(id2);

        expect(store.queue.queueItems.length).to.deep.equal(1);
        verify(responderStoreMock.updateQueue(anything())).thrice();
        verify(signerMock.sendTransaction(anything())).times(4);
    });

    fnIt<MultiResponder>(m => m.txMined, "does nothing when queue is empty", async () => {
        const responder = createResponder(increasingGasPriceEstimator);
        const qBefore = store.queue;
        await responder.txMined(new PisaTransactionIdentifier(1, "data", "to", new BigNumber(0), new BigNumber(10)), 1);
        expect(store.queue).to.deep.equal(qBefore);
        expect(store.queue.queueItems.length).to.deep.equal(0);
        verify(responderStoreMock.updateQueue(anything())).never();
        verify(signerMock.sendTransaction(anything())).never();
    });

    fnIt<MultiResponder>(m => m.txMined, "does nothing when item not in queue", async () => {
        const responder = createResponder(increasingGasPriceEstimator);
        await responder.startResponse(pisaContractAddress, data1, gasLimit, id1, startBlock, endBlock);
        verify(responderStoreMock.updateQueue(anything())).once();
        verify(signerMock.sendTransaction(anything())).once();

        const queueBefore = store.queue;
        await responder.txMined(new PisaTransactionIdentifier(1, "data", "to", new BigNumber(0), new BigNumber(10)), 1);
        expect(store.queue).to.equal(queueBefore);
        verify(responderStoreMock.updateQueue(anything())).once();
        verify(signerMock.sendTransaction(anything())).once();
    });

    fnIt<MultiResponder>(m => m.txMined, "does nothing nonce is not front of queue", async () => {
        const responder = createResponder(increasingGasPriceEstimator);
        await responder.startResponse(pisaContractAddress, data1, gasLimit, id1, startBlock, endBlock);
        verify(responderStoreMock.updateQueue(anything())).once();
        verify(signerMock.sendTransaction(anything())).once();

        const queueBefore = store.queue;
        const item = store.queue.queueItems[0];
        await responder.txMined(item.request.identifier, item.nonce + 1);
        expect(store.queue).to.equal(queueBefore);
    });

    fnIt<MultiResponder>(m => m.reEnqueueMissingItems, "does issue new transactions", async () => {
        // there are some items that are not in the queue, but are in the multi responder
        // we achieve this by adding the items, the mining them, then insisting they're still in pending
        const responder = createResponder(decreasingGasPriceEstimator);

        await responder.startResponse(pisaContractAddress, data1, gasLimit, id1, startBlock, endBlock);
        await responder.startResponse(pisaContractAddress, data2, gasLimit, id2, startBlock, endBlock);
        verify(responderStoreMock.updateQueue(anything())).twice();
        verify(signerMock.sendTransaction(anything())).twice();
        expect(store.queue.queueItems.length).to.equal(2);

        const item = responder.transactions.get(id1)!;
        await responder.txMined(item.request.identifier, item.nonce);
        verify(responderStoreMock.updateQueue(anything())).thrice();
        verify(signerMock.sendTransaction(anything())).twice();
        expect(store.queue.queueItems.length).to.equal(1);

        await responder.reEnqueueMissingItems([id1, id2]);
        verify(responderStoreMock.updateQueue(anything())).times(4);
        verify(signerMock.sendTransaction(anything())).thrice();
        expect(store.queue.queueItems.length).to.equal(2);
    });

    fnIt<MultiResponder>(m => m.reEnqueueMissingItems, "does replace transactions", async () => {
        // choose a lower gas fee for the first item - this should cause a double replacement
        const responder = createResponder(increasingGasPriceEstimator);

        await responder.startResponse(pisaContractAddress, data1, gasLimit, id1, startBlock, endBlock);
        const item = store.transactions.get(id1)!;
        await responder.txMined(item.request.identifier, item.nonce);

        await responder.startResponse(pisaContractAddress, data2, gasLimit, id2, startBlock, endBlock);
        const item2 = store.transactions.get(id2)!;
        verify(signerMock.sendTransaction(anything())).twice();

        // should only be one item in the queue
        expect(store.queue.queueItems.length).to.equal(1);

        const queueBefore = store.queue;
        await responder.reEnqueueMissingItems([id1, id2]);
        const replacedTransactions = store.queue.difference(queueBefore);
        expect(replacedTransactions.length).to.equal(2);
        expect(replacedTransactions[0].request.identifier).to.equal(item2.request.identifier);
        expect(replacedTransactions[0].nonce).to.equal(item.nonce);
        expect(replacedTransactions[1].request.identifier).to.equal(item.request.identifier);
        expect(replacedTransactions[1].nonce).to.equal(item2.nonce);

        verify(signerMock.sendTransaction(anything())).times(4);
    });

    fnIt<MultiResponder>(m => m.reEnqueueMissingItems, "throws error for missing transactions", async () => {
        const responder = createResponder(decreasingGasPriceEstimator);

        return expect(responder.reEnqueueMissingItems([id1])).to.eventually.be.rejectedWith(ArgumentError);
    });

    fnIt<MultiResponder>(m => m.reEnqueueMissingItems, "does nothing for no missing transactions", async () => {
        const responder = createResponder(decreasingGasPriceEstimator);

        await responder.startResponse(pisaContractAddress, data1, gasLimit, id1, startBlock, endBlock);
        await responder.startResponse(pisaContractAddress, data2, gasLimit, id2, startBlock, endBlock);

        const item = store.transactions.get(id1)!;
        await responder.txMined(item.request.identifier, item.nonce);

        const queueBefore = store.queue;
        await responder.reEnqueueMissingItems([id2]);
        const replacedTransactions = store.queue.difference(queueBefore);
        expect(replacedTransactions.length).to.equal(0);
    });

    fnIt<MultiResponder>(m => m.endResponse, "removes item from transactions", async () => {
        const responder = createResponder(decreasingGasPriceEstimator);

        await responder.startResponse(pisaContractAddress, data1, gasLimit, id1, startBlock, endBlock);
        expect(store.transactions.has(id1)).to.be.true;

        await responder.endResponse(id1);
        expect(store.transactions.has(id1)).to.be.false;
        verify(responderStoreMock.removeResponse(anything())).once();
    });
});
