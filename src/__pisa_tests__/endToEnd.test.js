"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("mocha");
const inspector_1 = require("./../inspector");
const watcher_1 = require("./../watcher");
const kitsuneTools_1 = require("./../kitsuneTools");
const ethers_1 = require("ethers");
const ganache_core_1 = __importDefault(require("ganache-core"));
const ganache = ganache_core_1.default.provider({
    mnemonic: "myth like bonus scare over problem client lizard pioneer submit female collect"
});
describe("End to end", () => {
    let player0, player1, pisaAccount, hashState, sig0, sig1, channelContract, round, provider = new ethers_1.ethers.providers.Web3Provider(ganache);
    before(() => __awaiter(this, void 0, void 0, function* () {
        provider.pollingInterval = 100;
        // set the 2 accounts
        const accounts = yield provider.listAccounts();
        player0 = accounts[0];
        player1 = accounts[1];
        pisaAccount = accounts[2];
        // deploy the channel
        const channelContractFactory = new ethers_1.ethers.ContractFactory(kitsuneTools_1.KitsuneTools.ContractAbi, kitsuneTools_1.KitsuneTools.ContractBytecode, provider.getSigner(accounts[3]));
        channelContract = yield channelContractFactory.deploy([player0, player1], 10);
        // set the round
        round = 1;
        // set the hash state
        hashState = ethers_1.ethers.utils.keccak256(ethers_1.ethers.utils.toUtf8Bytes("hello"));
        // set the sigs
        const setStateHash = kitsuneTools_1.KitsuneTools.hashForSetState(hashState, round, channelContract.address);
        sig0 = yield provider.getSigner(player0).signMessage(ethers_1.ethers.utils.arrayify(setStateHash));
        sig1 = yield provider.getSigner(player1).signMessage(ethers_1.ethers.utils.arrayify(setStateHash));
    }));
    it("inspect and watch a contract", () => __awaiter(this, void 0, void 0, function* () {
        const inspector = new inspector_1.KitsuneInspector(10, provider);
        // 1. Verify appointment
        const appointmentRequest = {
            stateUpdate: {
                contractAddress: channelContract.address,
                hashState: hashState,
                round: 1,
                signatures: [sig0, sig1]
            },
            expiryPeriod: 11
        };
        const appointment = yield inspector.inspect(appointmentRequest);
        // 2. pass this appointment to the watcher
        const watcher = new watcher_1.KitsuneWatcher(provider, provider.getSigner(pisaAccount));
        const player0Contract = channelContract.connect(provider.getSigner(player0));
        yield watcher.watch(appointment);
        // 3. Trigger a dispute
        const tx = yield player0Contract.triggerDispute();
        yield tx.wait();
        yield wait(2000);
    })).timeout(3000);
});
const wait = (timeout) => __awaiter(this, void 0, void 0, function* () {
    const testPromise = new Promise(function (resolve, reject) {
        setTimeout(function () {
            resolve();
        }, timeout);
    });
    return yield testPromise;
});
