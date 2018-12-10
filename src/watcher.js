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
const ethers_1 = require("ethers");
const kitsuneTools_1 = require("./kitsuneTools");
const logger_1 = __importDefault(require("./logger"));
const util_1 = require("util");
/**
 * A watcher is responsible for watching for, and responding to, events emitted on-chain.
 */
class Watcher {
    constructor(provider, signer, channelAbi, eventName, eventCallback) {
        this.provider = provider;
        this.signer = signer;
        this.channelAbi = channelAbi;
        this.eventName = eventName;
        this.eventCallback = eventCallback;
    }
    /**
     * Watch for an event specified by the appointment, and respond if it the event is raised.
     * @param appointment Contains information about where to watch for events, and what information to suppli as part of a response
     */
    watch(appointment) {
        return __awaiter(this, void 0, void 0, function* () {
            // PSA: safety check the appointment - check the inspection time?
            // create a contract
            logger_1.default.info(`Begin watching for event ${this.eventName} in contract ${appointment.stateUpdate.contractAddress}.`);
            logger_1.default.debug(`Watching appointment: ${appointment}.`);
            const contract = new ethers_1.ethers.Contract(appointment.stateUpdate.contractAddress, this.channelAbi, this.provider).connect(this.signer);
            // watch the supplied event
            contract.on(this.eventName, (...args) => __awaiter(this, void 0, void 0, function* () {
                // this callback should not throw exceptions as they cannot be handled elsewhere
                // PISA: 2. check that the dispute was triggered within the correct time period
                // call the callback
                try {
                    logger_1.default.info(`Observed event ${this.eventName} in contract ${contract.address} with arguments : ${args.slice(0, args.length - 1)}. Beginning response.`);
                    logger_1.default.debug(`Event info ${util_1.inspect(args[1])}`);
                    yield this.eventCallback(contract, appointment, ...args);
                }
                catch (doh) {
                    // an error occured whilst responding to the callback - this is serious and the problem needs to be correctly diagnosed
                    logger_1.default.error(`Error occured whilst responding to event ${this.eventName} in contract ${contract.address}.`);
                }
                // remove subscription - we've satisfied our appointment
                try {
                    logger_1.default.info(`Reponse successful, removing listener.`);
                    contract.removeAllListeners(this.eventName);
                    logger_1.default.info(`Listener removed.`);
                }
                catch (doh) {
                    logger_1.default.error(`Failed to remove listener on event ${this.eventName} in contract ${contract.address}.`);
                }
            }));
        });
    }
}
exports.Watcher = Watcher;
class KitsuneWatcher extends Watcher {
    constructor(provider, signer) {
        super(provider, signer, kitsuneTools_1.KitsuneTools.ContractAbi, "EventDispute(uint256)", kitsuneTools_1.KitsuneTools.respond);
    }
}
exports.KitsuneWatcher = KitsuneWatcher;
