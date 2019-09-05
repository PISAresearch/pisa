import { Appointment, ArgumentError, IBlockStub } from "../dataEntities";
import { ReadOnlyBlockCache } from "../blockMonitor";
import { BigNumber } from "ethers/utils";
import { ethers } from "ethers";

export class GasPriceEstimator {
    /**
     * Estimates gas prices for provided appointment data
     * @param provider
     * @param blockCache
     * @param gasCurveFactory A factory for generating curves from which to estimate gas prices.
    
     */
    public constructor(
        private readonly provider: ethers.providers.Provider,
        private readonly blockCache: ReadOnlyBlockCache<IBlockStub>
    ) {}

    /**
     * Uses the current state of the network, and any information to be found in the
     * appointment data, to try estimate an appropriate gas price.
     * @param appointmentData
     */
    public async estimate(endBlock: number): Promise<BigNumber> {
        const currentPrice = await this.provider.getGasPrice();
        const currentHead = this.blockCache.head;

        const timeLeft = endBlock - currentHead.number;

        // we set that the current gas price should be at the end block - 500
        const curve = new ExponentialGasCurve(currentPrice, endBlock - 500);
        return curve.getGasPrice(Math.max(timeLeft, 0));
    }
}

export class ExponentialCurve {
    /**
     * The constant k in the exponential function y = a\*e^(k\*x)
     */
    public readonly k: number;

    /**
     * The constant a in the exponential function y = a\*e^(k\*x)
     */
    public readonly a: number;

    /**
     * An exponential curve of the form, y = a\*e^(k\*x), derived from two points
     * This curve cannot cross the y axis, therfore we have that both y values be
     * positive, or both y values be negative. Y can never equal zero.
     * @param x1 The x coord of the first point. Cannot equal x2.
     * @param y1 The y coord of the first point. Cannot be 0. Must be positive if y2 is positive.
     * @param x2 The x coord of the second point. Cannot equal x1.
     * @param y2 The y coord of the second point. Cannot be 0. Must be positive if y1 is positive.
     */
    constructor(
        public readonly x1: number,
        public readonly y1: number,
        public readonly x2: number,
        public readonly y2: number
    ) {
        // we're not solving for the more general y = a*e^(k*x) + c
        // therefore we require that the curve does not cross the x-axis
        if (y1 === 0 || y2 == 0) throw new ArgumentError("Y values cannot equal zero.", y1, y2);
        if ((y1 < 0 && y2 > 0) || (y1 > 0 && y2 < 0)) {
            throw new ArgumentError("Y values most all be positive or all be negative.", y1, y2);
        }
        if (x1 === x2) throw new ArgumentError("x1 cannot equal x2 for exponential curve.", x1, x2);

        // exponential of the form y = a*e^(k*x)
        // which can be solved for two point (x1, y1) and (x2, y2)
        // (y1 / y2) = e^(k*x1 - k*x2)
        // ln(y1/y2) = k*(x1-x2)
        // k = (ln(y1/y2))/(x1-x2)
        // a = y1*e^(-k*x1)
        this.k = Math.log(y1 / y2) / (x1 - x2);
        this.a = y1 * Math.pow(Math.E, -(this.k * x1));
    }

    /**
     * Get the y coord of a point of the curve with the supplied x coord.
     */
    public getY(x: number) {
        // y = a*e^(k*x)
        return Math.fround(this.a * Math.pow(Math.E, this.k * x));
    }
}

export class ExponentialGasCurve {
    /**
     * The curve price cap. We'll never estimate a gas price higher than this.
     */
    public static readonly MAX_GAS_PRICE = 300000000000; //300 gwei

    /**
     * The block number at which we should move to maximum gas price.
     */
    public static readonly MAX_BLOCKS = 20; // blocks

    /**
     * Block number at which we aim to mine most transactions
     */
    public static readonly MEDIAN_BLOCKS = 50; // blocks
    /**
     * Average number of blocks it takes to mine a transaction at the node estimated
     * gas price (eth_gasPrice). This number should be measured, but for now we make a
     * conservative estimate of 5.
     */
    public static readonly AVERAGE_TO_MINE = 5; // blocks

    /**
     * The curve used to estimate gas price from number of blocks to the
     * deadline.
     */
    private readonly curve: ExponentialCurve;

    /**
     * An exponential curve to estimate a gas prices at which to mine transactions.
     * Initialised with the current network gas price, the curve can then be queried
     * to find a gas price given the distance in blocks from a deadline. As the deadline
     * is approached, the gas price increases exponentially.
     * @param currentGasPrice The most recently available gas price of the network. Cannot be negative.
     * @param currentGasPriceBlocksRemaining The number of blocks that should be remining when the gas curve uses the current gas price.
     */
    constructor(public readonly currentGasPrice: BigNumber, currentGasPriceBlocksRemaining?: number) {
        if (currentGasPrice.lt(0)) throw new ArgumentError("Gas price cannot be less than zero.");

        // gas price could be zero, but we need it to be positive to calculate the curve
        // in this case we choose 1 wei as the price
        if (currentGasPrice.eq(0)) currentGasPrice = new BigNumber(1);

        const maxedGasPrice = currentGasPrice.gt(ExponentialGasCurve.MAX_GAS_PRICE)
            ? new BigNumber(ExponentialGasCurve.MAX_GAS_PRICE)
            : currentGasPrice;

        // GAS PRICE ESTIMATION
        //
        //   gas price
        //      |
        //  MAX |_____
        //      |     |.
        //      |     |  .
        //      |     |      .
        //  EST |_ _ _| _ _ _ _ | _ _ ._ _ _
        //      |     |         |           |         .
        //      |_____|_________|___________|__________________> deadline distance
        //      0     A         B           C
        //
        // the graph shows the gas price that we will set according to
        // the distance we are from the DEADLINE (0). A transaction must be mined
        // before this distance reaches 0. To ensure this we aim to mine transactions
        // at an earlier point, the MEDIAN, (B) which gives calling code a chance to
        // replace transactions with a higher gas price. We follow an exponential curve
        // to increase the certainty of the transaction being mined as it approaches
        // the deadline. We also never increase gas prices beyond some maximum,
        // MAX_GAS_PRICE, which we aim to meet at point A, the MAX_DEADLINE.
        //
        // To calculate the exponential curve we take this max point, and another point which
        // has y position equal to the estimated gas price from the node, and x point equal to
        // the average number of blocks that it takes to mine at that estimated price, plus
        // the MEDIAN point, (C). This means that most transactions will be mined at the MEDIAN
        // point (B). Given these two points we can calculate the exponential for the
        // current gas price, then choose the gas price based on the deadline distance of
        // the end block.

        const x1 = ExponentialGasCurve.MAX_BLOCKS;
        const y1 = ExponentialGasCurve.MAX_GAS_PRICE;
        const x2 =
            currentGasPriceBlocksRemaining || ExponentialGasCurve.MEDIAN_BLOCKS + ExponentialGasCurve.AVERAGE_TO_MINE;

        // we know that maxed gas price is less than number.max_safe
        // therefore we can safely call toNumber
        const y2 = maxedGasPrice.toNumber();

        this.curve = new ExponentialCurve(x1, y1, x2, y2);
    }

    /**
     * Get an estimated gas price for the number of blocks left until a deadline is reached.
     * Never returns more than the MAX_GAS_PRICE which is reached at MAX_BLOCKS
     * @param blocksUntilDeadline The number of blocks until a deadline is reached. Cannot be less than 0.
     */
    public getGasPrice(blocksUntilDeadline: number) {
        if (blocksUntilDeadline < 0)
            throw new ArgumentError("blocksUntilDeadline cannot be less than zero.", blocksUntilDeadline);

        if (blocksUntilDeadline <= ExponentialGasCurve.MAX_BLOCKS) {
            return new BigNumber(ExponentialGasCurve.MAX_GAS_PRICE);
        }
        // we round this since we require that the gas is an integer
        else return new BigNumber(Math.round(this.curve.getY(blocksUntilDeadline)));
    }
}
