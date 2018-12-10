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
const request_promise_1 = __importDefault(require("request-promise"));
const kitsuneTools_1 = require("../kitsuneTools");
const ethers_1 = require("ethers");
const inspector_1 = require("../inspector");
const watcher_1 = require("../watcher");
const service_1 = require("../service");
const ganache_core_1 = __importDefault(require("ganache-core"));
const logger_1 = __importDefault(require("../logger"));
logger_1.default.transports.forEach(l => (l.level = "max"));
const ganache = ganache_core_1.default.provider({
    mnemonic: "myth like bonus scare over problem client lizard pioneer submit female collect"
});
const config = {
    host: {
        name: "localhost",
        port: 3000
    },
    jsonRpcUrl: "http://localhost:8545",
    watcherKey: "0x6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c"
};
const provider = new ethers_1.ethers.providers.Web3Provider(ganache);
provider.pollingInterval = 100;
describe("Service end-to-end", () => {
    let account0, account1, channelContract, hashState, disputePeriod, service;
    beforeEach(() => __awaiter(this, void 0, void 0, function* () {
        const watcherWallet = new ethers_1.ethers.Wallet(config.watcherKey, provider);
        const watcher = new watcher_1.KitsuneWatcher(provider, watcherWallet);
        const inspector = new inspector_1.KitsuneInspector(10, provider);
        service = new service_1.PisaService(config.host.name, config.host.port, inspector, watcher);
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
    afterEach(() => {
        service.stop();
    });
    it("create channel, submit appointment, trigger dispute, wait for response", () => __awaiter(this, void 0, void 0, function* () {
        const round = 1, setStateHash = kitsuneTools_1.KitsuneTools.hashForSetState(hashState, round, channelContract.address), sig0 = yield provider.getSigner(account0).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), sig1 = yield provider.getSigner(account1).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), expiryPeriod = disputePeriod + 1;
        const appointmentRequest = {
            expiryPeriod,
            stateUpdate: {
                contractAddress: channelContract.address,
                hashState,
                round,
                signatures: [sig0, sig1]
            }
        };
        yield request_promise_1.default.post(`http://${config.host.name}:${config.host.port}/appointment`, { json: appointmentRequest });
        // now register a callback on the setstate event and trigger a response
        const setStateEvent = "EventEvidence(uint256, bytes32)";
        let successResult = { success: false };
        channelContract.on(setStateEvent, () => {
            channelContract.removeAllListeners(setStateEvent);
            successResult.success = true;
        });
        // trigger a dispute
        const tx = yield channelContract.triggerDispute();
        yield tx.wait();
        try {
            // wait for the success result
            yield waitForPredicate(successResult, s => s.success, 400);
        }
        catch (doh) {
            // fail if we dont get it
            chai.assert.fail(true, false, "EventEvidence not successfully registered.");
        }
    })).timeout(3000);
    it("create channel, submit round = 0 too low returns 400", () => __awaiter(this, void 0, void 0, function* () {
        const round = 0, setStateHash = kitsuneTools_1.KitsuneTools.hashForSetState(hashState, round, channelContract.address), sig0 = yield provider.getSigner(account0).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), sig1 = yield provider.getSigner(account1).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), expiryPeriod = disputePeriod + 1;
        const appointmentRequest = {
            expiryPeriod,
            stateUpdate: {
                contractAddress: channelContract.address,
                hashState,
                round,
                signatures: [sig0, sig1]
            }
        };
        yield failWithCode('400 - "Supplied appointment round', appointmentRequest);
    })).timeout(3000);
    it("create channel, submit round = -1 too low returns 400", () => __awaiter(this, void 0, void 0, function* () {
        const round = -1, setStateHash = kitsuneTools_1.KitsuneTools.hashForSetState(hashState, round, channelContract.address), sig0 = yield provider.getSigner(account0).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), sig1 = yield provider.getSigner(account1).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), expiryPeriod = disputePeriod + 1;
        const appointmentRequest = {
            expiryPeriod,
            stateUpdate: {
                contractAddress: channelContract.address,
                hashState,
                round,
                signatures: [sig0, sig1]
            }
        };
        yield failWithCode('400 - "Supplied appointment round', appointmentRequest);
    })).timeout(3000);
    it("create channel, expiry = dispute period returns 400", () => __awaiter(this, void 0, void 0, function* () {
        const round = 1, setStateHash = kitsuneTools_1.KitsuneTools.hashForSetState(hashState, round, channelContract.address), sig0 = yield provider.getSigner(account0).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), sig1 = yield provider.getSigner(account1).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), expiryPeriod = disputePeriod;
        const appointmentRequest = {
            expiryPeriod,
            stateUpdate: {
                contractAddress: channelContract.address,
                hashState,
                round,
                signatures: [sig0, sig1]
            }
        };
        yield failWithCode('400 - "Supplied appointment expiryPeriod', appointmentRequest);
    })).timeout(3000);
    it("create channel, expiry period = dispute period - 1 too low returns 400", () => __awaiter(this, void 0, void 0, function* () {
        const round = 1, setStateHash = kitsuneTools_1.KitsuneTools.hashForSetState(hashState, round, channelContract.address), sig0 = yield provider.getSigner(account0).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), sig1 = yield provider.getSigner(account1).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), expiryPeriod = disputePeriod - 1;
        const appointmentRequest = {
            expiryPeriod,
            stateUpdate: {
                contractAddress: channelContract.address,
                hashState,
                round,
                signatures: [sig0, sig1]
            }
        };
        yield failWithCode('400 - "Supplied appointment expiryPeriod', appointmentRequest);
    })).timeout(3000);
    it("create channel, non existant contact returns 400", () => __awaiter(this, void 0, void 0, function* () {
        const round = 1, setStateHash = kitsuneTools_1.KitsuneTools.hashForSetState(hashState, round, channelContract.address), sig0 = yield provider.getSigner(account0).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), sig1 = yield provider.getSigner(account1).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), expiryPeriod = disputePeriod + 1;
        const appointmentRequest = {
            expiryPeriod,
            stateUpdate: {
                // random address
                contractAddress: "0x4bf3A7dFB3b76b5B3E169ACE65f888A4b4FCa5Ee",
                hashState,
                round,
                signatures: [sig0, sig1]
            }
        };
        yield failWithCode(`400 - "No code found at address ${appointmentRequest.stateUpdate.contractAddress}`, appointmentRequest);
    })).timeout(3000);
    it("create channel, invalid contract address returns 400", () => __awaiter(this, void 0, void 0, function* () {
        const round = 1, setStateHash = kitsuneTools_1.KitsuneTools.hashForSetState(hashState, round, channelContract.address), sig0 = yield provider.getSigner(account0).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), sig1 = yield provider.getSigner(account1).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), expiryPeriod = disputePeriod + 1;
        const appointmentRequest = {
            expiryPeriod,
            stateUpdate: {
                // invalid address
                contractAddress: "0x4bf3A7dFB3b76b",
                hashState,
                round,
                signatures: [sig0, sig1]
            }
        };
        yield failWithCode(`400 - "${appointmentRequest.stateUpdate.contractAddress} is not a valid address.`, appointmentRequest);
    })).timeout(3000);
    it("create channel, invalid state hash returns 400", () => __awaiter(this, void 0, void 0, function* () {
        const round = 1, setStateHash = kitsuneTools_1.KitsuneTools.hashForSetState(hashState, round, channelContract.address), sig0 = yield provider.getSigner(account0).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), sig1 = yield provider.getSigner(account1).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), expiryPeriod = disputePeriod + 1;
        const appointmentRequest = {
            expiryPeriod,
            stateUpdate: {
                contractAddress: channelContract.address,
                // invalid hash state
                hashState: "0x4bf3A7dFB3b76b",
                round,
                signatures: [sig0, sig1]
            }
        };
        yield failWithCode(`400 - "Invalid bytes32: ${appointmentRequest.stateUpdate.hashState}`, appointmentRequest);
    })).timeout(3000);
    it("create channel, wrong state hash returns 400", () => __awaiter(this, void 0, void 0, function* () {
        const round = 1, setStateHash = kitsuneTools_1.KitsuneTools.hashForSetState(hashState, round, channelContract.address), sig0 = yield provider.getSigner(account0).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), sig1 = yield provider.getSigner(account1).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), expiryPeriod = disputePeriod + 1;
        const appointmentRequest = {
            expiryPeriod,
            stateUpdate: {
                contractAddress: channelContract.address,
                // substute the state hash for the set state hash
                hashState: setStateHash,
                round,
                signatures: [sig0, sig1]
            }
        };
        yield failWithCode('400 - "Party 0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1 not present in signatures', appointmentRequest);
    })).timeout(3000);
    it("create channel, wrong sig on hash returns 400", () => __awaiter(this, void 0, void 0, function* () {
        const expiryPeriod = disputePeriod + 1, round = 1, 
        // setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address),
        // sign the wrong hash
        sig0 = yield provider.getSigner(account0).signMessage(ethers_1.ethers.utils.arrayify(hashState)), sig1 = yield provider.getSigner(account1).signMessage(ethers_1.ethers.utils.arrayify(hashState));
        const appointmentRequest = {
            expiryPeriod,
            stateUpdate: {
                contractAddress: channelContract.address,
                hashState,
                round,
                signatures: [sig0, sig1]
            }
        };
        yield failWithCode('400 - "Party 0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1 not present in signatures', appointmentRequest);
    })).timeout(3000);
    it("create channel, sigs by only one player returns 400", () => __awaiter(this, void 0, void 0, function* () {
        const expiryPeriod = disputePeriod + 1, round = 1, setStateHash = kitsuneTools_1.KitsuneTools.hashForSetState(hashState, round, channelContract.address), 
        // sign both with account 0
        sig0 = yield provider.getSigner(account0).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), sig1 = yield provider.getSigner(account0).signMessage(ethers_1.ethers.utils.arrayify(setStateHash));
        const appointmentRequest = {
            expiryPeriod,
            stateUpdate: {
                contractAddress: channelContract.address,
                hashState,
                round,
                signatures: [sig0, sig1]
            }
        };
        yield failWithCode('400 - "Party 0xFFcf8FDEE72ac11b5c542428B35EEF5769C409f0 not present in signatures', appointmentRequest);
    })).timeout(3000);
    it("create channel, missing sig returns 400", () => __awaiter(this, void 0, void 0, function* () {
        const expiryPeriod = disputePeriod + 1, round = 1, setStateHash = kitsuneTools_1.KitsuneTools.hashForSetState(hashState, round, channelContract.address), 
        //sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash)),
        sig1 = yield provider.getSigner(account1).signMessage(ethers_1.ethers.utils.arrayify(setStateHash));
        const appointmentRequest = {
            expiryPeriod,
            stateUpdate: {
                contractAddress: channelContract.address,
                hashState,
                round,
                signatures: [sig1]
            }
        };
        yield failWithCode('400 - "Incorrect number of signatures supplied', appointmentRequest);
    })).timeout(3000);
    it("create channel, sigs in wrong order returns 200", () => __awaiter(this, void 0, void 0, function* () {
        const round = 1, setStateHash = kitsuneTools_1.KitsuneTools.hashForSetState(hashState, round, channelContract.address), sig0 = yield provider.getSigner(account0).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), sig1 = yield provider.getSigner(account1).signMessage(ethers_1.ethers.utils.arrayify(setStateHash)), expiryPeriod = disputePeriod + 1;
        const appointmentRequest = {
            expiryPeriod,
            stateUpdate: {
                contractAddress: channelContract.address,
                hashState,
                round,
                signatures: [sig0, sig1]
            }
        };
        try {
            yield request_promise_1.default.post(`http://${config.host.name}:${config.host.port}/appointment`, {
                json: appointmentRequest
            });
        }
        catch (doh) {
            chai.assert.fail();
        }
    })).timeout(3000);
    const failWithCode = (errorMessage, appointmentRequest) => __awaiter(this, void 0, void 0, function* () {
        try {
            yield request_promise_1.default.post(`http://${config.host.name}:${config.host.port}/appointment`, {
                json: appointmentRequest
            });
            chai.assert.fail(true, false, "Request was successful when it should have failed.");
        }
        catch (doh) {
            if (doh instanceof Error && doh.message.startsWith(errorMessage)) {
                // success
            }
            else if (doh instanceof Error) {
                chai.assert.fail(true, false, doh.message);
            }
            else
                chai.assert.fail(true, false, doh);
        }
    });
});
// assess the value of a predicate after a timeout, throws if predicate does not evaluate to true
const waitForPredicate = (successResult, predicate, timeout) => {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            if (predicate(successResult)) {
                resolve();
            }
            else {
                reject();
            }
        }, timeout);
    });
};
