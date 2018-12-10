"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const chai = __importStar(require("chai"));
require("mocha");
const inspector_1 = require("./../inspector");
const kitsuneTools_1 = require("./../kitsuneTools");
const ethers_1 = require("ethers");
const ganache_core_1 = __importDefault(require("ganache-core"));
const ganache = ganache_core_1.default.provider({
    mnemonic: "myth like bonus scare over problem client lizard pioneer submit female collect"
});
const provider = new ethers_1.ethers.providers.Web3Provider(ganache);
const expect = chai.expect;
const isRejected = (result) => __awaiter(this, void 0, void 0, function* () {
    return yield result.then(() => {
        chai.assert.fail();
    }, reject => {
        expect(reject).to.exist;
    });
});
// PISA: test constructor, and create receipt
describe("Inspector", () => {
    let account0, account1, channelContract, hashState, disputePeriod;
    before(() => __awaiter(this, void 0, void 0, function* () {
        // accounts
        const accounts = yield provider.listAccounts();
        account0 = accounts[0];
        account1 = accounts[1];
        // set the dispute period
        disputePeriod = 10;
        // contract
        const channelContractFactory = new ethers_1.ethers.ContractFactory(kitsuneTools_1.KitsuneTools.ContractAbi, kitsuneTools_1.KitsuneTools.ContractBytecode, provider.getSigner());
        channelContract = yield channelContractFactory.deploy([account0, account1], disputePeriod);
        hashState = ethers_1.ethers.utils.keccak256(ethers_1.ethers.utils.toUtf8Bytes("face-off"));
    }));
    it("accepts appointment", () => __awaiter(this, void 0, void 0, function* () {
        const round = 1, setStateHash = kitsuneTools_1.KitsuneTools.hashForSetState(hashState, round, channelContract.address), sig0 = yield provider.getSigner(account0).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), sig1 = yield provider.getSigner(account1).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), expiryPeriod = disputePeriod + 1;
        const inspector = new inspector_1.KitsuneInspector(10, provider);
        yield inspector.inspect({
            expiryPeriod,
            stateUpdate: {
                contractAddress: channelContract.address,
                hashState,
                round,
                signatures: [sig0, sig1]
            }
        });
        // PISA: test the return value of inspect in all cases
    }));
    it("throws for round too low", () => __awaiter(this, void 0, void 0, function* () {
        const round = 0, setStateHash = kitsuneTools_1.KitsuneTools.hashForSetState(hashState, round, channelContract.address), sig0 = yield provider.getSigner(account0).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), sig1 = yield provider.getSigner(account1).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), expiryPeriod = disputePeriod + 1;
        const inspector = new inspector_1.KitsuneInspector(10, provider);
        yield isRejected(inspector.inspect({
            expiryPeriod,
            stateUpdate: {
                contractAddress: channelContract.address,
                hashState,
                round,
                signatures: [sig0, sig1]
            }
        }));
    }));
    it("throws for expiry equal dispute time", () => __awaiter(this, void 0, void 0, function* () {
        const expiryPeriod = disputePeriod, round = 1, setStateHash = kitsuneTools_1.KitsuneTools.hashForSetState(hashState, round, channelContract.address), sig0 = yield provider.getSigner(account0).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), sig1 = yield provider.getSigner(account1).signMessage(ethers_1.ethers.utils.arrayify(setStateHash));
        const inspector = new inspector_1.KitsuneInspector(10, provider);
        yield isRejected(inspector.inspect({
            expiryPeriod,
            stateUpdate: {
                contractAddress: channelContract.address,
                hashState,
                round,
                signatures: [sig0, sig1]
            }
        }));
    }));
    it("throws for expiry less than dispute time", () => __awaiter(this, void 0, void 0, function* () {
        const expiryPeriod = disputePeriod - 1, round = 1, setStateHash = kitsuneTools_1.KitsuneTools.hashForSetState(hashState, round, channelContract.address), sig0 = yield provider.getSigner(account0).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), sig1 = yield provider.getSigner(account1).signMessage(ethers_1.ethers.utils.arrayify(setStateHash));
        const inspector = new inspector_1.KitsuneInspector(10, provider);
        yield isRejected(inspector.inspect({
            expiryPeriod,
            stateUpdate: {
                contractAddress: channelContract.address,
                hashState,
                round,
                signatures: [sig0, sig1]
            }
        }));
    }));
    it("throws for non existant contract", () => __awaiter(this, void 0, void 0, function* () {
        const expiryPeriod = disputePeriod + 1, round = 1, setStateHash = kitsuneTools_1.KitsuneTools.hashForSetState(hashState, round, channelContract.address), sig0 = yield provider.getSigner(account0).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), sig1 = yield provider.getSigner(account1).signMessage(ethers_1.ethers.utils.arrayify(setStateHash));
        const inspector = new inspector_1.KitsuneInspector(10, provider);
        yield isRejected(inspector.inspect({
            expiryPeriod,
            stateUpdate: {
                // random address
                contractAddress: "0x4bf3A7dFB3b76b5B3E169ACE65f888A4b4FCa5Ee",
                hashState,
                round,
                signatures: [sig0, sig1]
            }
        }));
    }));
    it("throws for invalid contract address", () => __awaiter(this, void 0, void 0, function* () {
        const expiryPeriod = disputePeriod + 1, round = 1, setStateHash = kitsuneTools_1.KitsuneTools.hashForSetState(hashState, round, channelContract.address), sig0 = yield provider.getSigner(account0).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), sig1 = yield provider.getSigner(account1).signMessage(ethers_1.ethers.utils.arrayify(setStateHash));
        const inspector = new inspector_1.KitsuneInspector(10, provider);
        // PISA: raise an isse on ethers js about this unhandled promise rejection
        yield isRejected(inspector.inspect({
            expiryPeriod,
            stateUpdate: {
                // invalid address
                contractAddress: "0x4bf3A7dFB3b76b",
                hashState,
                round,
                signatures: [sig0, sig1]
            }
        }));
    }));
    it("throws for invalid state hash", () => __awaiter(this, void 0, void 0, function* () {
        const expiryPeriod = disputePeriod + 1, round = 1, setStateHash = kitsuneTools_1.KitsuneTools.hashForSetState(hashState, round, channelContract.address), sig0 = yield provider.getSigner(account0).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), sig1 = yield provider.getSigner(account1).signMessage(ethers_1.ethers.utils.arrayify(setStateHash));
        const inspector = new inspector_1.KitsuneInspector(10, provider);
        yield isRejected(inspector.inspect({
            expiryPeriod,
            stateUpdate: {
                contractAddress: channelContract.address,
                // invalid hash state
                hashState: "0x4bf3A7dFB3b76b",
                round,
                signatures: [sig0, sig1]
            }
        }));
    }));
    it("throws for wrong state hash", () => __awaiter(this, void 0, void 0, function* () {
        const expiryPeriod = disputePeriod + 1, round = 1, setStateHash = kitsuneTools_1.KitsuneTools.hashForSetState(hashState, round, channelContract.address), sig0 = yield provider.getSigner(account0).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), sig1 = yield provider.getSigner(account1).signMessage(ethers_1.ethers.utils.arrayify(setStateHash));
        const inspector = new inspector_1.KitsuneInspector(10, provider);
        yield isRejected(inspector.inspect({
            expiryPeriod,
            stateUpdate: {
                contractAddress: channelContract.address,
                // substute the state hash for the set state hash
                hashState: setStateHash,
                round,
                signatures: [sig0, sig1]
            }
        }));
    }));
    it("throws for sigs on wrong hash", () => __awaiter(this, void 0, void 0, function* () {
        const expiryPeriod = disputePeriod + 1, round = 1, 
        // setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address),
        // sign the wrong hash
        sig0 = yield provider.getSigner(account0).signMessage(ethers_1.ethers.utils.arrayify(hashState)), sig1 = yield provider.getSigner(account1).signMessage(ethers_1.ethers.utils.arrayify(hashState));
        const inspector = new inspector_1.KitsuneInspector(10, provider);
        yield isRejected(inspector.inspect({
            expiryPeriod,
            stateUpdate: {
                contractAddress: channelContract.address,
                hashState,
                round,
                signatures: [sig0, sig1]
            }
        }));
    }));
    it("throws for sigs by only one player", () => __awaiter(this, void 0, void 0, function* () {
        const expiryPeriod = disputePeriod + 1, round = 1, setStateHash = kitsuneTools_1.KitsuneTools.hashForSetState(hashState, round, channelContract.address), 
        // sign both with account 0
        sig0 = yield provider.getSigner(account0).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), sig1 = yield provider.getSigner(account0).signMessage(ethers_1.ethers.utils.arrayify(setStateHash));
        const inspector = new inspector_1.KitsuneInspector(10, provider);
        yield isRejected(inspector.inspect({
            expiryPeriod,
            stateUpdate: {
                contractAddress: channelContract.address,
                hashState,
                round,
                signatures: [sig0, sig1]
            }
        }));
    }));
    it("throws for missing sig", () => __awaiter(this, void 0, void 0, function* () {
        const expiryPeriod = disputePeriod + 1, round = 1, setStateHash = kitsuneTools_1.KitsuneTools.hashForSetState(hashState, round, channelContract.address), 
        //sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash)),
        sig1 = yield provider.getSigner(account1).signMessage(ethers_1.ethers.utils.arrayify(setStateHash));
        const inspector = new inspector_1.KitsuneInspector(10, provider);
        yield isRejected(inspector.inspect({
            expiryPeriod,
            stateUpdate: {
                contractAddress: channelContract.address,
                hashState,
                round,
                signatures: [sig1]
            }
        }));
    }));
    it("accepts sigs in wrong order", () => __awaiter(this, void 0, void 0, function* () {
        // PISA: shouldnt we support changing the order?
        const expiryPeriod = disputePeriod + 1, round = 1, setStateHash = kitsuneTools_1.KitsuneTools.hashForSetState(hashState, round, channelContract.address), sig0 = yield provider.getSigner(account0).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), sig1 = yield provider.getSigner(account1).signMessage(ethers_1.ethers.utils.arrayify(setStateHash));
        const inspector = new inspector_1.KitsuneInspector(10, provider);
        yield inspector.inspect({
            expiryPeriod,
            stateUpdate: {
                contractAddress: channelContract.address,
                hashState,
                round,
                signatures: [sig1, sig0]
            }
        });
    }));
});
