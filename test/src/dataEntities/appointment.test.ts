import "mocha";
import chai, { expect } from "chai";
import fnIt from "../../utils/fnIt";
import { Appointment, PublicDataValidationError, IBlockStub } from "../../../src/dataEntities";
import { ethers } from "ethers";
import chaiAsPromised from "chai-as-promised";
import { ReadOnlyBlockCache, BlockCache } from "../../../src/blockMonitor";
import { mock, when, instance } from "ts-mockito";
chai.use(chaiAsPromised);

const customerPrivKey = "0xd40be03d93b1ab00d334df3fe683da2d360e95fbfd132178facc3a8f5d9eb620";
const customerSigner = new ethers.Wallet(customerPrivKey);
const testAppointmentRequest = {
    challengePeriod: 100,
    contractAddress: "0x254dffcd3277C0b1660F6d42EFbB754edaBAbC2B",
    customerAddress: "0x70397134f9c6941831626763807c3B88f7DD3520",
    data:
        "0x3f5de7ed00000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000001a2092ea24441ee16935c133fe2d1ed0e32943170e152dc2bedb5d2a77329ff9700000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000001e381099b9b03ab851cd7739122f23bff199aa5c8ac0651be34c0d6c764219f053baa2964f68540e9677500a10ca7be151744a3f7c1d28b7b3852f40f19cc39440000000000000000000000000000000000000000000000000000000000000000d40134d0f5e32e54258e608ca434654478612ac7e37b0a8de6cb44d915602be7623a6f44f9d63808cf27fc25f625b61bc99667a62aaef4cf6e934cdf92ee2c0b",
    endBlock: 22,
    eventABI: "event EventDispute(uint256 indexed)",
    eventArgs:
        "0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000",
    gasLimit: "100000",
    id: 1,
    jobId: 0,
    mode: 1,
    preCondition: "0xfc1624bdc50da30f2ea37b7debabeac1f6166db013c5880dcf63907b04199138",
    postCondition: "0xfc1624bdc50da30f2ea37b7debabeac1f6166db013c5880dcf63907b04199138",
    refund: "0",
    startBlock: 6,
    paymentHash: "0xfc1624bdc50da30f2ea37b7debabeac1f6166db013c5880dcf63907b04199138",
    customerSig: "0xfc1624bdc50da30f2ea37b7debabeac1f6166db013c5880dcf63907b04199138"
};

const stringifyBigNumbers = (appointment: Appointment) => {
    const { gasLimit, refund, ...r } = appointment;
    return { gasLimitString: gasLimit.toString(), refundString: refund.toString(), ...r };
};

describe("Appointment", () => {
    let blockCache: BlockCache<IBlockStub>;

    beforeEach(() => {
        const blockCacheMock: BlockCache<IBlockStub> = mock(BlockCache);
        when(blockCacheMock.head).thenReturn({ parentHash: "parent", hash: "hash", number: 7 });
        blockCache = instance(blockCacheMock);
    });

    fnIt<Appointment>(() => Appointment.parse, "correctly parse valid appointment", () => {
        const { id, gasLimit, refund, ...requestRest } = testAppointmentRequest;
        const app = Appointment.parse(testAppointmentRequest);
        const { customerChosenId, gasLimitString, refundString, ...appRequest } = stringifyBigNumbers(app);

        expect(requestRest).to.deep.equal(appRequest);
        expect(id).to.deep.equal(customerChosenId);
        expect(gasLimit).to.deep.equal(gasLimitString);
        expect(refund).to.deep.equal(refundString);
    });

    fnIt<Appointment>(() => Appointment.parse, "throws error for any missing propery", () => {
        for (const key of Object.keys(testAppointmentRequest)) {
            const clone = { ...testAppointmentRequest };
            delete (clone as any)[key];
            expect(() => Appointment.parse(clone)).to.throw(PublicDataValidationError);
        }
    });

    fnIt<Appointment>(() => Appointment.parse, "allows big numbers", () => {
        const clone = { ...testAppointmentRequest };
        clone.refund = "10000000000000000000000000000000000000000000000000000000000000000000000000007";
        clone.gasLimit = "10000000000000000000000000000000000000000000000000000000000000000000000000005";
        const app = Appointment.parse(clone);
        expect(app.refund.toString()).to.equal(clone.refund);
        expect(app.gasLimit.toString()).to.equal(clone.gasLimit);
    });

    fnIt<Appointment>(() => Appointment.parse, "throws for big numbers that are NaN", () => {
        const clone = { ...testAppointmentRequest };
        clone.refund = "hi";
        expect(() => Appointment.parse(clone)).to.throw(PublicDataValidationError);

        const clone2 = { ...testAppointmentRequest };
        clone2.gasLimit = "yeah";
        expect(() => Appointment.parse(clone2)).to.throw(PublicDataValidationError);
    });

    fnIt<Appointment>(() => Appointment.parse, "throws for big numbers that are NaN", () => {
        const clone = { ...testAppointmentRequest };
        clone.refund = "hi";
        expect(() => Appointment.parse(clone)).to.throw(PublicDataValidationError);

        const clone2 = { ...testAppointmentRequest };
        clone2.gasLimit = "yeah";
        expect(() => Appointment.parse(clone2)).to.throw(PublicDataValidationError);
    });

    fnIt<Appointment>(() => Appointment.parse, "throws for non number", () => {
        const clone = { ...testAppointmentRequest };
        clone.endBlock = "hi" as any;
        expect(() => Appointment.parse(clone)).to.throw(PublicDataValidationError);
    });

    fnIt<Appointment>(() => Appointment.parse, "throws for negative number", () => {
        const clone = { ...testAppointmentRequest };
        clone.endBlock = -1;
        expect(() => Appointment.parse(clone)).to.throw(PublicDataValidationError);
    });
    fnIt<Appointment>(() => Appointment.parse, "throws for too large number", () => {
        const clone = { ...testAppointmentRequest };
        clone.endBlock = Number.MAX_SAFE_INTEGER + 1;
        expect(() => Appointment.parse(clone)).to.throw(PublicDataValidationError);
    });

    fnIt<Appointment>(() => Appointment.parse, "throws for negative big number", () => {
        const clone = { ...testAppointmentRequest };
        clone.refund = "-1";
        expect(() => Appointment.parse(clone)).to.throw(PublicDataValidationError);
    });

    fnIt<Appointment>(() => Appointment.parse, "throws for non string", () => {
        const clone = { ...testAppointmentRequest };
        clone.paymentHash = 10 as any;
        expect(() => Appointment.parse(clone)).to.throw(PublicDataValidationError);
    });

    fnIt<Appointment>(() => Appointment.parse, "can parse any mode number", () => {
        const clone = { ...testAppointmentRequest };
        clone.mode = 10000;
        const { id, gasLimit, refund, ...requestRest } = testAppointmentRequest;
        const app = Appointment.parse(testAppointmentRequest);
        const { customerChosenId, gasLimitString, refundString, ...appRequest } = stringifyBigNumbers(app);

        expect(requestRest).to.deep.equal(appRequest);
        expect(id).to.deep.equal(customerChosenId);
        expect(gasLimit).to.deep.equal(gasLimitString);
        expect(refund).to.deep.equal(refundString);
    });

    const sign = async (appointment: Appointment, wallet: ethers.Wallet) => {
        const encoded = appointment.encode();
        const sig = await wallet.signMessage(ethers.utils.arrayify(encoded));
        const clone = { ...Appointment.toIAppointmentRequest(appointment), customerSig: sig };
        return Appointment.parse(clone);
    };

    fnIt<Appointment>(a => a.validate, "passes for correct appointment", async () => {
        const clone = { ...testAppointmentRequest };

        clone.eventABI = "event Face(address indexed, uint256, uint256 indexed)";
        clone.eventArgs = ethers.utils.defaultAbiCoder.encode(
            ["uint8[]", "address", "uint256"],
            [[0, 2], "0xbbF5029Fd710d227630c8b7d338051B8E76d50B3", 20]
        );
        const testAppointment = Appointment.parse(clone);
        const signedAppointment = await sign(testAppointment, customerSigner);
        await signedAppointment.validate(blockCache);
    });

    fnIt<Appointment>(a => a.validate, "throws for non freeHash", async () => {
        const clone = { ...testAppointmentRequest };
        // invalid hash
        clone.paymentHash = "0x11359291abdee43476905204ea224bd2c1ccc775f283d280ed61f8f0ce94483e";
        const testAppointment = Appointment.parse(clone);
        const signedAppointment = await sign(testAppointment, customerSigner);

        return expect(signedAppointment.validate(blockCache)).to.eventually.be.rejectedWith(PublicDataValidationError);
    });

    fnIt<Appointment>(a => a.validate, "abi must be an event", async () => {
        const clone = { ...testAppointmentRequest };
        clone.eventABI = "function Face(address indexed, uint256, uint256 indexed)";
        clone.eventArgs = ethers.utils.defaultAbiCoder.encode(
            ["uint8[]", "address", "uint256"],
            [[0, 2], "0xbbF5029Fd710d227630c8b7d338051B8E76d50B3", 20]
        );
        const testAppointment = Appointment.parse(clone);
        const signedAppointment = await sign(testAppointment, customerSigner);

        return expect(signedAppointment.validate(blockCache)).to.eventually.be.rejectedWith(PublicDataValidationError);
    });

    fnIt<Appointment>(a => a.validate, "abi first args must be uint8[]", async () => {
        const clone = { ...testAppointmentRequest };
        clone.eventABI = "event Face(address indexed, uint256, uint256 indexed)";
        clone.eventArgs = ethers.utils.defaultAbiCoder.encode(
            ["address", "uint256"],
            ["0xbbF5029Fd710d227630c8b7d338051B8E76d50B3", 20]
        );
        const testAppointment = Appointment.parse(clone);
        const signedAppointment = await sign(testAppointment, customerSigner);

        return expect(signedAppointment.validate(blockCache)).to.eventually.be.rejectedWith(PublicDataValidationError);
    });

    fnIt<Appointment>(a => a.validate, "can specify only some of the indexed arguments", async () => {
        const clone = { ...testAppointmentRequest };
        clone.eventABI = "event Face(address indexed, uint256, uint256 indexed)";
        clone.eventArgs = ethers.utils.defaultAbiCoder.encode(["uint8[]", "uint256"], [[2], 20]);
        const testAppointment = Appointment.parse(clone);
        const signedAppointment = await sign(testAppointment, customerSigner);

        await signedAppointment.validate(blockCache);
    });

    // TODO:274:should not be able to specufy "uint8[]", [[2]] - with a 2 in here
    fnIt<Appointment>(a => a.validate, "can specify none of the indexed arguments", async () => {
        const clone = { ...testAppointmentRequest };
        clone.eventABI = "event Face(address indexed, uint256, uint256 indexed)";
        clone.eventArgs = ethers.utils.defaultAbiCoder.encode(["uint8[]"], [[]]);

        const testAppointment = Appointment.parse(clone);
        const signedAppointment = await sign(testAppointment, customerSigner);

        await signedAppointment.validate(blockCache);
    });

    fnIt<Appointment>(a => a.validate, "index must be less than number of arguments to event", async () => {
        const clone = { ...testAppointmentRequest };
        clone.eventABI = "event Face(address indexed, uint256)";
        clone.eventArgs = ethers.utils.defaultAbiCoder.encode(
            ["uint8[]", "address", "uint256"],
            [[0, 2], "0xbbF5029Fd710d227630c8b7d338051B8E76d50B3", 20]
        );
        const testAppointment = Appointment.parse(clone);
        const signedAppointment = await sign(testAppointment, customerSigner);
        return expect(signedAppointment.validate(blockCache)).to.eventually.be.rejectedWith(PublicDataValidationError);
    });

    fnIt<Appointment>(a => a.validate, "can parse booleans", async () => {
        const clone = { ...testAppointmentRequest };
        clone.eventABI = "event Face(bool indexed, uint256, uint256 indexed)";
        clone.eventArgs = ethers.utils.defaultAbiCoder.encode(["uint8[]", "bool", "uint256"], [[0, 2], true, 20]);
        const testAppointment = Appointment.parse(clone);
        const signedAppointment = await sign(testAppointment, customerSigner);
        await signedAppointment.validate(blockCache);
    });

    fnIt<Appointment>(a => a.validate, "non indexed types cannot be specified", async () => {
        const clone = { ...testAppointmentRequest };
        clone.eventABI = "event Face(address indexed, uint256, uint256 indexed)";
        clone.eventArgs = ethers.utils.defaultAbiCoder.encode(
            ["uint8[]", "address", "uint256"],
            [[0, 1], "0xbbF5029Fd710d227630c8b7d338051B8E76d50B3", 20]
        );
        const testAppointment = Appointment.parse(clone);
        const signedAppointment = await sign(testAppointment, customerSigner);
        return expect(signedAppointment.validate(blockCache)).to.eventually.be.rejectedWith(PublicDataValidationError);
    });

    fnIt<Appointment>(a => a.validate, "struct types cannot be specified", async () => {
        const clone = { ...testAppointmentRequest };
        // try to specify a struct
        clone.eventABI = "event Face(address indexed, uint256, Off indexed)";
        clone.eventArgs = ethers.utils.defaultAbiCoder.encode(
            ["uint8[]", "address", "uint256"],
            [[0, 2], "0xbbF5029Fd710d227630c8b7d338051B8E76d50B3", 20]
        );
        const testAppointment = Appointment.parse(clone);
        const signedAppointment = await sign(testAppointment, customerSigner);
        return expect(signedAppointment.validate(blockCache)).to.eventually.be.rejectedWith(PublicDataValidationError);
    });

    fnIt<Appointment>(a => a.validate, "throws gas limit > 6000000", async () => {
        const clone = { ...testAppointmentRequest };
        clone.gasLimit = "6000001";
        const app = Appointment.parse(clone);
        const signedAppointment = await sign(app, customerSigner);
        return expect(signedAppointment.validate(blockCache)).to.eventually.be.rejectedWith(PublicDataValidationError);
    });

    fnIt<Appointment>(a => a.validate, "throws refund > 0.1 ether", async () => {
        const clone = { ...testAppointmentRequest };
        clone.refund = ethers.utils
            .parseEther("0.1")
            .add(1)
            .toString();
        const app = Appointment.parse(clone);
        const signedAppointment = await sign(app, customerSigner);
        return expect(signedAppointment.validate(blockCache)).to.eventually.be.rejectedWith(PublicDataValidationError);
    });

    fnIt<Appointment>(a => a.validate, "throws for invalid signature", async () => {
        const clone = { ...testAppointmentRequest };

        clone.eventABI = "event Face(address indexed, uint256, uint256 indexed)";
        clone.eventArgs = ethers.utils.defaultAbiCoder.encode(
            ["uint8[]", "address", "uint256"],
            [[0, 2], "0xbbF5029Fd710d227630c8b7d338051B8E76d50B3", 20]
        );
        const testAppointment = Appointment.parse(clone);
        const differentSigner = new ethers.Wallet("0x2206ec9b25a3dd5233b78a56a7b03ed424ba3731eaa1d14a5dd8bfa8328e1d1a");
        const signedAppointment = await sign(testAppointment, differentSigner);
        return expect(signedAppointment.validate(blockCache)).to.eventually.be.rejectedWith(PublicDataValidationError);
    });

    fnIt<Appointment>(a => a.validate, "throws for start block too low", async () => {
        const clone = { ...testAppointmentRequest };
        clone.startBlock = 1;
        const testAppointment = Appointment.parse(clone);
        const signedAppointment = await sign(testAppointment, customerSigner);
        return expect(signedAppointment.validate(blockCache)).to.eventually.be.rejectedWith(PublicDataValidationError);
    });

    fnIt<Appointment>(a => a.validate, "throws for start block too high", async () => {
        const clone = { ...testAppointmentRequest };
        clone.startBlock = 13;
        const testAppointment = Appointment.parse(clone);
        const signedAppointment = await sign(testAppointment, customerSigner);
        return expect(signedAppointment.validate(blockCache)).to.eventually.be.rejectedWith(PublicDataValidationError);
    });

    fnIt<Appointment>(a => a.validate, "start block - end block > 60000", async () => {
        const clone = { ...testAppointmentRequest };
        clone.startBlock = 7;
        clone.endBlock = 60008;
        const testAppointment = Appointment.parse(clone);
        const signedAppointment = await sign(testAppointment, customerSigner);
        return expect(signedAppointment.validate(blockCache)).to.eventually.be.rejectedWith(PublicDataValidationError);
    });
});
