import "mocha";
import { MultiResponder, GasPriceEstimator } from "../../../src/responder";
import Ganache from "ganache-core";
import { ethers } from "ethers";
import { mock, when, anything, instance } from "ts-mockito";
import { BigNumber } from "ethers/utils";
import { expect } from "chai";
import { ArgumentError, IEthereumResponseData, Block } from "../../../src/dataEntities";
import { PisaTransactionIdentifier } from "../../../src/responder/gasQueue";
import { BlockProcessor, ReadOnlyBlockCache } from "../../../src/blockMonitor";

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
        errorGasEstimatorMock: GasPriceEstimator,
        blockProcessor: BlockProcessor<Block>;
    const maxConcurrentResponses = 3;
    const replacementRate = 15;

    let address: string, chainId: number;

    before(async () => {
        address = await signer.getAddress();
        chainId = signer.provider.network.chainId;
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

        // TODO:198: decide what to do here

        const mockedBlockProcessor = mock(BlockProcessor);
        // TODO:198: it is expected to read the maxDepth from the blockCach; but this is ugly
        when(mockedBlockProcessor.blockCache).thenReturn({ maxDepth: 10 } as ReadOnlyBlockCache<Block>);
        blockProcessor = instance(mockedBlockProcessor);
    });

    it("constructor throws for negative replacement rate", async () => {
        expect(
            () => new MultiResponder(blockProcessor, signer, increasingGasPriceEstimator, maxConcurrentResponses, -1)
        ).to.throw(ArgumentError);
    });

    it("constructor throws for zero max concurrency", async () => {
        expect(
            () => new MultiResponder(blockProcessor, signer, increasingGasPriceEstimator, 0, replacementRate)
        ).to.throw(ArgumentError);
    });

    it("startResponse can issue transaction", async () => {
        const appointmentId = "app1";
        const responseData = createResponseData("app1");

        const responder = new MultiResponder(
            blockProcessor,
            signer,
            increasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );
        await responder.start();

        await responder.startResponse(appointmentId, responseData);

        await responder.stop();

        // TODO:198: success conditions?
        // verify(transactionTrackerMock.addTx(anything(), anything())).once();
    });

    it("startResponse can issue two transactions and replace", async () => {
        const appointmentId = "app1";
        const responseData = createResponseData("app1");
        const appointmentId2 = "app2";
        const responseData2 = createResponseData("app2");

        const responder = new MultiResponder(
            blockProcessor,
            signer,
            increasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );

        await responder.start();

        await responder.startResponse(appointmentId, responseData);
        // TODO:198: success conditions?
        // verify(transactionTrackerMock.addTx(anything(), anything())).once();
        // because the gas price is increasing this should result in a replacement
        // therefor two additional transactions are issued, rather than just one
        await responder.startResponse(appointmentId2, responseData2);
        // TODO:198: success conditions?
        // verify(transactionTrackerMock.addTx(anything(), anything())).times(3);

        await responder.stop();
    });

    it("startResponse can issue two transactions but not replace", async () => {
        const appointmentId = "app1";
        const responseData = createResponseData("app1");
        const appointmentId2 = "app2";
        const responseData2 = createResponseData("app2");

        const responder = new MultiResponder(
            blockProcessor,
            signer,
            // decreasing
            decreasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );

        await responder.start();

        await responder.startResponse(appointmentId, responseData);
        // TODO:198: success conditions?
        // verify(transactionTrackerMock.addTx(anything(), anything())).once();
        // because the gas price is decreasing this should result not result in a replacement
        // therefore only one new transaction should be issued
        await responder.startResponse(appointmentId2, responseData2);
        // TODO:198: success conditions?
        // verify(transactionTrackerMock.addTx(anything(), anything())).times(2);

        await responder.stop();
    });

    it("startResponse swallows error", async () => {
        const appointmentId = "app1";
        const responseData = createResponseData("app1");

        const responder = new MultiResponder(
            blockProcessor,
            signer,
            errorGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );

        await responder.start()

        await responder.startResponse(appointmentId, responseData);
        // TODO:198: success conditions?
        // verify(transactionTrackerMock.addTx(anything(), anything())).never();
        await responder.stop()
    });

    it("startResponse doesnt queue beyond max depth", async () => {
        const appointmentId = "app1";
        const responseData = createResponseData("app1");
        const appointmentId2 = "app2";
        const responseData2 = createResponseData("app2");
        const appointmentId3 = "app3";
        const responseData3 = createResponseData("app3");

        const responder = new MultiResponder(
            blockProcessor,
            signer,
            decreasingGasPriceEstimator,
            2,
            replacementRate
        );

        await responder.start();

        await responder.startResponse(appointmentId, responseData);
        await responder.startResponse(appointmentId2, responseData2);
        // TODO:198: success conditions?
        // verify(transactionTrackerMock.addTx(anything(), anything())).times(2);
        // adding again should do nothing
        await responder.startResponse(appointmentId3, responseData3);
        // TODO:198: success conditions?
        // verify(transactionTrackerMock.addTx(anything(), anything())).times(2);

        await responder.stop();
    });

    it("txMined does dequeue", async () => {
        const appointmentId = "app1";
        const responseData = createResponseData("app1");
        const responder = new MultiResponder(
            blockProcessor,
            signer,
            increasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );

        await responder.start();

        await responder.startResponse(appointmentId, responseData);
        const item = responder.queue.queueItems[0];

        // TODO:198: we need to test txMined for different 'from' variants - in all places for txMined
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
            blockProcessor,
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

        await responder.txMined(item.request.identifier, item.nonce, address);
        const itemAfterMined = responder.queue.queueItems[0];

        expect(responder.queue.queueItems.length).to.equal(1);
        expect(itemAfterMined.request.identifier).to.deep.equal(itemAfterReplace.request.identifier);
        expect(itemAfterMined.nonce).to.equal(itemAfterReplace.nonce + 1);
        // TODO:198: success conditions?
        // verify(transactionTrackerMock.addTx(anything(), anything())).times(4);

        await responder.stop();
    });

    it("txMined does nothing when queue is empty", async () => {
        const responder = new MultiResponder(
            blockProcessor,
            signer,
            increasingGasPriceEstimator,
            maxConcurrentResponses,
            replacementRate
        );

        await responder.start();
        await responder.txMined(
            new PisaTransactionIdentifier(1, "data", "to", new BigNumber(0), new BigNumber(10)),
            1,
            address
        );
        expect(responder.queue.queueItems.length).to.equal(0);

        await responder.stop();
        // TODO:198: success conditions?
        // verify(transactionTrackerMock.addTx(anything(), anything())).never();
    });

    it("txMined does nothing when item not in queue", async () => {
        const appointmentId = "app1";
        const responseData = createResponseData("app1");
        const responder = new MultiResponder(
            blockProcessor,
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
        // TODO:198: success conditions?
        // verify(transactionTrackerMock.addTx(anything(), anything())).once();
    });

    it("txMined does nothing nonce is not front of queue", async () => {
        const appointmentId = "app1";
        const responseData = createResponseData("app1");
        const responder = new MultiResponder(
            blockProcessor,
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
        // TODO:198: success conditions?
        // verify(transactionTrackerMock.addTx(anything(), anything())).once();
    });
});
