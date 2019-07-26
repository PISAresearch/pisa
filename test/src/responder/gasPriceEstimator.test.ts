import "mocha";
import { expect } from "chai";
import { ExponentialCurve, ExponentialGasCurve, GasPriceEstimator } from "../../../src/responder/gasPriceEstimator";
import { ArgumentError, IBlockStub } from "../../../src/dataEntities";
import { BigNumber } from "ethers/utils";
import { mock, when, instance } from "ts-mockito";
import { ethers } from "ethers";
import { BlockCache } from "../../../src/blockMonitor";

describe("ExponentialCurve", () => {
    it("ka constructs for (0, 1), (1, e)", () => {
        // for (0, 1), (1, e) we should have a = 1, k = 1
        const curve = new ExponentialCurve(0, 1, 1, Math.E);
        expect(curve.a).to.equal(1);
        expect(curve.k).to.equal(1);
    });

    it("ka constructs for (0, 10), (1, e)", () => {
        // for (0, 10), (1, e) we should have a = 10, k = ln (e / 10)
        const curve = new ExponentialCurve(0, 10, 1, Math.E);
        expect(curve.a).to.equal(10);
        expect(Math.fround(curve.k)).to.equal(Math.fround(Math.log(Math.E / 10)));
    });

    it("ka constructs for (-1, 5), (1, 10)", () => {
        // for (-1, 5), (1, 10) we should have a = sqrt(50), k = 1/2 ln 2
        const curve = new ExponentialCurve(-1, 5, 1, 10);
        expect(Math.fround(curve.a)).to.equal(Math.fround(Math.sqrt(50)));
        expect(Math.fround(curve.k)).to.equal(Math.fround(0.5 * Math.log(2)));
    });

    it("construct fails for x1 = x2", () => {
        expect(() => new ExponentialCurve(3, 5, 3, 10)).to.throw(ArgumentError);
    });

    it("construct fails for one negative y value", () => {
        // neither or both negative
        new ExponentialCurve(3, 5, 7, 10);
        new ExponentialCurve(3, -5, 7, -10);

        // one negative
        expect(() => new ExponentialCurve(3, -5, 7, 10)).to.throw(ArgumentError);
        expect(() => new ExponentialCurve(3, 5, 7, -10)).to.throw(ArgumentError);
    });

    it("getY returns orignal points", () => {
        const curve = new ExponentialCurve(-1, 5, 1, 10);
        expect(Math.fround(curve.getY(-1))).to.equal(5);
        expect(Math.fround(curve.getY(1))).to.equal(10);
    });

    it("getY returns new point", () => {
        const curve = new ExponentialCurve(0, 1, 1, Math.E);
        // should have (2, e^2) for curve a = 1, k = 1
        expect(Math.fround(curve.getY(2))).to.equal(Math.fround(Math.pow(Math.E, 2)));
    });
});

describe("ExponentialGasCurve", () => {
    it("constructor does not accept negative gasPrice", () => {
        expect(() => new ExponentialGasCurve(new BigNumber(-1))).to.throw(ArgumentError);
    });

    it("max initial gas gives max curve", () => {
        const y2 = 400000000000;
        const expGasCurve = new ExponentialGasCurve(new BigNumber(y2));
        const expCurve = new ExponentialCurve(
            ExponentialGasCurve.MAX_BLOCKS,
            ExponentialGasCurve.MAX_GAS_PRICE,
            ExponentialGasCurve.AVERAGE_TO_MINE + ExponentialGasCurve.MEDIAN_BLOCKS,
            // should be set to max blocks for the y2 values greater than max value
            ExponentialGasCurve.MAX_GAS_PRICE
        );

        expect(expGasCurve.getGasPrice(ExponentialGasCurve.MAX_BLOCKS + 20).toNumber()).to.equal(
            Math.round(expCurve.getY(ExponentialGasCurve.MAX_BLOCKS + 20))
        );
    });

    it("getGasPrice returns same as curve", () => {
        const y2 = 21000000000;
        const expGasCurve = new ExponentialGasCurve(new BigNumber(y2));
        const expCurve = new ExponentialCurve(
            ExponentialGasCurve.MAX_BLOCKS,
            ExponentialGasCurve.MAX_GAS_PRICE,
            ExponentialGasCurve.AVERAGE_TO_MINE + ExponentialGasCurve.MEDIAN_BLOCKS,
            y2
        );

        expect(expGasCurve.getGasPrice(ExponentialGasCurve.MAX_BLOCKS + 20).toNumber()).to.equal(
            Math.round(expCurve.getY(ExponentialGasCurve.MAX_BLOCKS + 20))
        );
    });

    it("getGasPrice returns the max gas price for less blocks than max blocks", () => {
        const y2 = 21000000000;
        const expGasCurve = new ExponentialGasCurve(new BigNumber(y2));
        expect(expGasCurve.getGasPrice(ExponentialGasCurve.MAX_BLOCKS - 1).toNumber()).to.equal(
            ExponentialGasCurve.MAX_GAS_PRICE
        );
    });

    it("getGasPrice throws for negative blocks", () => {
        const y2 = 21000000000;
        const expGasCurve = new ExponentialGasCurve(new BigNumber(y2));
        expect(() => expGasCurve.getGasPrice(-1)).to.throw(ArgumentError);
    });
});

describe("GasPriceEstimator", () => {
    it("estimate", async () => {
        const currentGasPrice = new BigNumber(21000000000);
        const currentBlock = 1;
        const endBlock = 3;

        const mockedProvider = mock(ethers.providers.JsonRpcProvider);
        when(mockedProvider.getGasPrice()).thenResolve(currentGasPrice);
        const provider = instance(mockedProvider);

        const mockedBlockCache: BlockCache<IBlockStub> = mock(BlockCache);
        when(mockedBlockCache.head).thenReturn({ hash: "hash1", parentHash: "hash2", number: 1 });
        const blockCache = instance(mockedBlockCache);

        const gasPriceEstimator = new GasPriceEstimator(provider, blockCache);
        const estimate = await gasPriceEstimator.estimate({
            contractAbi: "contract",
            contractAddress: "address",
            endBlock: 3,
            functionArgs: [],
            functionName: "fn"
        });
        const expectedValue = new ExponentialGasCurve(currentGasPrice).getGasPrice(endBlock - currentBlock);

        expect(estimate.toNumber()).to.equal(expectedValue.toNumber());
    });
});
