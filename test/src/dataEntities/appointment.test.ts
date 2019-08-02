import "mocha";
import { expect } from "chai";
import fnIt from "../../utils/fnIt";
import { Appointment, PublicDataValidationError } from "../../../src/dataEntities";
import { ethers } from "ethers";

const testAppointmentRequest = {
    challengePeriod: 20,
    contractAddress: "0x254dffcd3277C0b1660F6d42EFbB754edaBAbC2B",
    customerAddress: "0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1",
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
    postCondition: "0xfc1624bdc50da30f2ea37b7debabeac1f6166db013c5880dcf63907b04199138",
    refund: "0",
    startBlock: 0,
    paymentHash: "0xfc1624bdc50da30f2ea37b7debabeac1f6166db013c5880dcf63907b04199138"
};

const stringifyBigNumbers = (appointment: Appointment) => {
    const { gasLimit, refund, ...r } = appointment;
    return { gasLimitString: gasLimit.toString(), refundString: refund.toString(), ...r };
};

describe("Appointment", () => {
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

    fnIt<Appointment>(a => a.validate, "passes for correct appointment", () => {
        const clone = { ...testAppointmentRequest };
        clone.eventABI = "event Face(address indexed, uint256, uint256 indexed)";
        clone.eventArgs = ethers.utils.defaultAbiCoder.encode(
            ["uint8[]", "address", "uint256"],
            [[0, 2], "0xbbF5029Fd710d227630c8b7d338051B8E76d50B3", 20]
        );
        const testAppointment = Appointment.parse(clone);
        testAppointment.validate();
    });

    fnIt<Appointment>(a => a.validate, "throws for non freeHash", () => {
        const clone = { ...testAppointmentRequest };
        // invalid hash
        clone.paymentHash = "0x11359291abdee43476905204ea224bd2c1ccc775f283d280ed61f8f0ce94483e";
        const testAppointment = Appointment.parse(clone);

        expect(() => testAppointment.validate()).to.throw(PublicDataValidationError);
    });

    fnIt<Appointment>(a => a.validate, "abi must be an event", () => {
        const clone = { ...testAppointmentRequest };
        clone.eventABI = "function Face(address indexed, uint256, uint256 indexed)";
        clone.eventArgs = ethers.utils.defaultAbiCoder.encode(
            ["uint8[]", "address", "uint256"],
            [[0, 2], "0xbbF5029Fd710d227630c8b7d338051B8E76d50B3", 20]
        );
        const testAppointment = Appointment.parse(clone);
        expect(() => testAppointment.validate()).to.throw(PublicDataValidationError);
    });

    fnIt<Appointment>(a => a.validate, "abi first args must be uint8[]", () => {
        const clone = { ...testAppointmentRequest };
        clone.eventABI = "event Face(address indexed, uint256, uint256 indexed)";
        clone.eventArgs = ethers.utils.defaultAbiCoder.encode(
            ["address", "uint256"],
            ["0xbbF5029Fd710d227630c8b7d338051B8E76d50B3", 20]
        );
        const testAppointment = Appointment.parse(clone);
        expect(() => testAppointment.validate()).to.throw(PublicDataValidationError);
    });

    fnIt<Appointment>(a => a.validate, "can specify only some of the indexed arguments", () => {
        const clone = { ...testAppointmentRequest };
        clone.eventABI = "event Face(address indexed, uint256, uint256 indexed)";
        clone.eventArgs = ethers.utils.defaultAbiCoder.encode(["uint8[]", "uint256"], [[2], 20]);
        const testAppointment = Appointment.parse(clone);
        testAppointment.validate();
    });

    fnIt<Appointment>(a => a.validate, "index must be less than number of arguments to event", () => {
        const clone = { ...testAppointmentRequest };
        clone.eventABI = "event Face(address indexed, uint256)";
        clone.eventArgs = ethers.utils.defaultAbiCoder.encode(
            ["uint8[]", "address", "uint256"],
            [[0, 2], "0xbbF5029Fd710d227630c8b7d338051B8E76d50B3", 20]
        );
        const testAppointment = Appointment.parse(clone);
        expect(() => testAppointment.validate()).to.throw(PublicDataValidationError);
    });

    fnIt<Appointment>(a => a.validate, "can parse booleans", () => {
        const clone = { ...testAppointmentRequest };
        clone.eventABI = "event Face(bool indexed, uint256, uint256 indexed)";
        clone.eventArgs = ethers.utils.defaultAbiCoder.encode(["uint8[]", "bool", "uint256"], [[0, 2], true, 20]);
        const testAppointment = Appointment.parse(clone);
        testAppointment.validate();
    });

    fnIt<Appointment>(a => a.validate, "non indexed types cannot be specified", () => {
        const clone = { ...testAppointmentRequest };
        clone.eventABI = "event Face(address indexed, uint256, uint256 indexed)";
        clone.eventArgs = ethers.utils.defaultAbiCoder.encode(
            ["uint8[]", "address", "uint256"],
            [[0, 1], "0xbbF5029Fd710d227630c8b7d338051B8E76d50B3", 20]
        );
        const testAppointment = Appointment.parse(clone);
        expect(() => testAppointment.validate()).to.throw(PublicDataValidationError);
    });

    fnIt<Appointment>(a => a.validate, "struct types cannot be specified", () => {
        const clone = { ...testAppointmentRequest };
        // try to specify a struct
        clone.eventABI = "event Face(address indexed, uint256, Off indexed)";
        clone.eventArgs = ethers.utils.defaultAbiCoder.encode(
            ["uint8[]", "address", "uint256"],
            [[0, 2], "0xbbF5029Fd710d227630c8b7d338051B8E76d50B3", 20]
        );
        const testAppointment = Appointment.parse(clone);
        expect(() => testAppointment.validate()).to.throw(PublicDataValidationError);
    });

    fnIt<Appointment>(a => a.validate, "throws gas limit > 6000000", () => {
        const clone = { ...testAppointmentRequest };
        clone.gasLimit = "6000001";
        const app = Appointment.parse(clone);
        expect(() => app.validate()).to.throw(PublicDataValidationError);
    });

    fnIt<Appointment>(a => a.validate, "throws refund > 0.1 ether", () => {
        const clone = { ...testAppointmentRequest };
        clone.refund = ethers.utils.parseEther("0.1").add(1).toString();
        const app = Appointment.parse(clone);
        expect(() => app.validate()).to.throw(PublicDataValidationError);
    });

});
