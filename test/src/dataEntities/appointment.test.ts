import "mocha";
import chai, { expect } from "chai";
import fnIt from "../../utils/fnIt";
import { Appointment, PublicDataValidationError, IBlockStub } from "../../../src/dataEntities";
import { ethers } from "ethers";
import chaiAsPromised from "chai-as-promised";
import { BlockCache } from "../../../src/blockMonitor";
import { encodeTopicsForPisa } from "../../../src/utils/ethers";
import { mock, when, instance } from "ts-mockito";
chai.use(chaiAsPromised);

const customerPrivKey = "0xd40be03d93b1ab00d334df3fe683da2d360e95fbfd132178facc3a8f5d9eb620";
const customerSigner = new ethers.Wallet(customerPrivKey);

const testAppointmentABI = [
	{
		"anonymous": false,
		"inputs": [
			{
				"indexed": true,
				"internalType": "address",
				"name": "",
				"type": "address"
			},
			{
				"indexed": false,
				"internalType": "uint256",
				"name": "",
				"type": "uint256"
			},
			{
				"indexed": true,
				"internalType": "uint256",
				"name": "",
				"type": "uint256"
			}
		],
		"name": "Face",
		"type": "event"
	}
];

const iFace = new ethers.utils.Interface(testAppointmentABI);
const topics = iFace.events["Face"].encodeTopics(["0xbbF5029Fd710d227630c8b7d338051B8E76d50B3", null, "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"]); // topics as array

const testAppointmentRequest = {
    challengePeriod: 100,
    contractAddress: "0x254dffcd3277C0b1660F6d42EFbB754edaBAbC2B",
    customerAddress: "0x70397134f9c6941831626763807c3B88f7DD3520",
    data:
        "0x3f5de7ed00000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000001a2092ea24441ee16935c133fe2d1ed0e32943170e152dc2bedb5d2a77329ff9700000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000001e381099b9b03ab851cd7739122f23bff199aa5c8ac0651be34c0d6c764219f053baa2964f68540e9677500a10ca7be151744a3f7c1d28b7b3852f40f19cc39440000000000000000000000000000000000000000000000000000000000000000d40134d0f5e32e54258e608ca434654478612ac7e37b0a8de6cb44d915602be7623a6f44f9d63808cf27fc25f625b61bc99667a62aaef4cf6e934cdf92ee2c0b",
    endBlock: 200,
    eventAddress: "0x254dffcd3277C0b1660F6d42EFbB754edaBAbC2B",
    topics: encodeTopicsForPisa(topics),
    gasLimit: 100000,
    id: "0x0000000000000000000000000000000000000000000000000000000000000001",
    nonce: 0,
    mode: 1,
    preCondition: "0x",
    postCondition: "0x",
    refund: "0",
    startBlock: 99,
    paymentHash: "0xfc1624bdc50da30f2ea37b7debabeac1f6166db013c5880dcf63907b04199138",
    customerSig: "0xfc1624bdc50da30f2ea37b7debabeac1f6166db013c5880dcf63907b04199138"
};

const pisaContractAddress = "0x70397134f9c6941831626763807c3B88f7DD3520";

const stringifyBigNumbers = (appointment: Appointment) => {
    const { refund, ...r } = appointment;
    return { refundString: refund.toString(), ...r };
};

describe("Appointment", () => {
    let blockCache: BlockCache<IBlockStub>;

    beforeEach(() => {
        const blockCacheMock: BlockCache<IBlockStub> = mock(BlockCache);
        when(blockCacheMock.head).thenReturn({ parentHash: "parent", hash: "hash", number: 100 });
        blockCache = instance(blockCacheMock);
    });

    fnIt<Appointment>(() => Appointment.parse, "correctly parse valid appointment", () => {
        const { id, refund, ...requestRest } = testAppointmentRequest;
        const app = Appointment.parse(testAppointmentRequest);
        const { customerChosenId, refundString, ...appRequest } = stringifyBigNumbers(app);

        expect(requestRest).to.deep.equal(appRequest);
        expect(id).to.deep.equal(customerChosenId);
        expect(refund).to.deep.equal(refundString);
    });

    fnIt<Appointment>(() => Appointment.parse, "throws error for any missing propery", () => {
        for (const key of Object.keys(testAppointmentRequest)) {
            const clone = { ...testAppointmentRequest };
            delete (clone as any)[key];
            expect(() => Appointment.parse(clone)).to.throw(PublicDataValidationError);
        }
    });

    fnIt<Appointment>(() => Appointment.parse, "throws for big numbers that are NaN", () => {
        const clone = { ...testAppointmentRequest };
        clone.refund = "hi";
        expect(() => Appointment.parse(clone)).to.throw(PublicDataValidationError);
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

    fnIt<Appointment>(() => Appointment.parse, "mode can be 0", () => {
        const clone = { ...testAppointmentRequest };
        clone.mode = 0;

        let { id, refund, ...requestRest } = clone;
        const app = Appointment.parse(clone);
        let { customerChosenId, refundString, ...appRequest } = stringifyBigNumbers(app);

        expect(requestRest).to.deep.equal(appRequest);
        expect(id).to.deep.equal(customerChosenId);
        expect(refund).to.deep.equal(refundString);
    });

    fnIt<Appointment>(() => Appointment.parse, "mode can be 1", () => {
        const clone = { ...testAppointmentRequest };
        clone.mode = 1;

        let { id, refund, ...requestRest } = clone;
        const app = Appointment.parse(clone);
        let { customerChosenId, refundString, ...appRequest } = stringifyBigNumbers(app);

        expect(requestRest).to.deep.equal(appRequest);
        expect(id).to.deep.equal(customerChosenId);
        expect(refund).to.deep.equal(refundString);
    });

    fnIt<Appointment>(() => Appointment.parse, "mode cannot be another number", () => {
        const clone = { ...testAppointmentRequest };
        clone.mode = 2;
        expect(() => Appointment.parse(clone)).to.throw(PublicDataValidationError);
    });

    fnIt<Appointment>(() => Appointment.parse, "does not accept non-zero refund", () => {
        const clone = { ...testAppointmentRequest };
        clone.refund = "10000";
        expect(() => Appointment.parse(clone)).to.throw(PublicDataValidationError);
    });

    const sign = async (appointment: Appointment, wallet: ethers.Wallet) => {
        const hashedWithAddress = ethers.utils.keccak256(appointment.encodeForSig(pisaContractAddress));
        const sig = await wallet.signMessage(ethers.utils.arrayify(hashedWithAddress));
        const clone = { ...Appointment.toIAppointmentRequest(appointment), customerSig: sig };
        return Appointment.parse(clone);
    };

    fnIt<Appointment>(a => a.validate, "passes for correct appointment", async () => {
        const testAppointment = Appointment.parse(testAppointmentRequest);
        const signedAppointment = await sign(testAppointment, customerSigner);
        await signedAppointment.validate(blockCache, pisaContractAddress);
    });

    fnIt<Appointment>(a => a.validate, "throws for non freeHash", async () => {
        const clone = { ...testAppointmentRequest };
        // invalid hash
        clone.paymentHash = "0x11359291abdee43476905204ea224bd2c1ccc775f283d280ed61f8f0ce94483e";
        const testAppointment = Appointment.parse(clone);
        const signedAppointment = await sign(testAppointment, customerSigner);

        return expect(signedAppointment.validate(blockCache, pisaContractAddress)).to.eventually.be.rejectedWith(
            PublicDataValidationError
        );
    });

    fnIt<Appointment>(a => a.validate, "can specify only some of the indexed arguments", async () => {
        const clone = { ...testAppointmentRequest };
        const topics = iFace.events["Face"].encodeTopics([null, null, "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"]); // topics as array
        clone.topics = encodeTopicsForPisa(topics);
        const testAppointment = Appointment.parse(clone);
        const signedAppointment = await sign(testAppointment, customerSigner);

        await signedAppointment.validate(blockCache, pisaContractAddress);
    });

    fnIt<Appointment>(a => a.validate, "can specify none of the indexed arguments", async () => {
        const clone = { ...testAppointmentRequest };
        const topics = iFace.events["Face"].encodeTopics([null, null, null]); // topics as array
        clone.topics = encodeTopicsForPisa(topics);

        const testAppointment = Appointment.parse(clone);
        const signedAppointment = await sign(testAppointment, customerSigner);

        await signedAppointment.validate(blockCache, pisaContractAddress);
    });

    fnIt<Appointment>(a => a.validate, "throws refund > 0.1 ether", async () => {
        const app = Appointment.parse(testAppointmentRequest);
        const signedAppointment = await sign(app, customerSigner);
        const appClone = Appointment.fromIAppointment({
            ...Appointment.toIAppointment(signedAppointment),
            refund: ethers.utils
                .parseEther("0.1")
                .add(1)
                .toString()
        });

        return expect(appClone.validate(blockCache, pisaContractAddress)).to.eventually.be.rejectedWith(
            PublicDataValidationError
        );
    });

    fnIt<Appointment>(a => a.validate, "throws for invalid signature", async () => {
        const testAppointment = Appointment.parse(testAppointmentRequest);

        const differentSigner = new ethers.Wallet("0x2206ec9b25a3dd5233b78a56a7b03ed424ba3731eaa1d14a5dd8bfa8328e1d1a");
        const signedAppointment = await sign(testAppointment, differentSigner);
        return expect(signedAppointment.validate(blockCache, pisaContractAddress)).to.eventually.be.rejectedWith(
            PublicDataValidationError
        );
    });

    fnIt<Appointment>(a => a.validate, "throws for start block too low", async () => {
        const clone = { ...testAppointmentRequest };
        clone.startBlock = 1;
        const testAppointment = Appointment.parse(clone);
        const signedAppointment = await sign(testAppointment, customerSigner);
        return expect(signedAppointment.validate(blockCache, pisaContractAddress)).to.eventually.be.rejectedWith(
            PublicDataValidationError
        );
    });

    fnIt<Appointment>(a => a.validate, "throws for start block too high", async () => {
        const clone = { ...testAppointmentRequest };
        clone.startBlock = 113;
        const testAppointment = Appointment.parse(clone);
        const signedAppointment = await sign(testAppointment, customerSigner);
        return expect(signedAppointment.validate(blockCache, pisaContractAddress)).to.eventually.be.rejectedWith(
            PublicDataValidationError
        );
    });

    fnIt<Appointment>(a => a.validate, "start block - end block > 60000", async () => {
        const clone = { ...testAppointmentRequest };
        clone.startBlock = 100;
        clone.endBlock = 60108;
        const testAppointment = Appointment.parse(clone);
        const signedAppointment = await sign(testAppointment, customerSigner);
        return expect(signedAppointment.validate(blockCache, pisaContractAddress)).to.eventually.be.rejectedWith(
            PublicDataValidationError
        );
    });

    fnIt<Appointment>(a => a.validate, "relay mode passes for zero'd topics", async () => {
        const clone = { ...testAppointmentRequest };
        clone.mode = 0;
        clone.eventAddress = "0x0000000000000000000000000000000000000000";
        clone.topics = "";
        const testAppointment = Appointment.parse(clone);
        const signedAppointment = await sign(testAppointment, customerSigner);
        await signedAppointment.validate(blockCache, pisaContractAddress);
    });

    fnIt<Appointment>(a => a.validate, "relay mode fails for non zero topics", async () => {
        const clone = { ...testAppointmentRequest };
        clone.mode = 0;
        const testAppointment = Appointment.parse(clone);
        const signedAppointment = await sign(testAppointment, customerSigner);
        return expect(signedAppointment.validate(blockCache, pisaContractAddress)).to.eventually.be.rejectedWith(
            PublicDataValidationError
        );
    });
});
