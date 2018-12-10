"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("ethers/utils");
const ethers_1 = require("ethers");
const StateChannel = require("../statechannels/build/contracts/StateChannel.json");
// PISA: this class...
class KitsuneTools {
    static hashForSetState(hState, round, channelAddress) {
        return utils_1.solidityKeccak256(["bytes32", "uint256", "address"], [hState, round, channelAddress]);
    }
    static respond(contract, appointment) {
        return __awaiter(this, void 0, void 0, function* () {
            let sig0 = ethers_1.utils.splitSignature(appointment.stateUpdate.signatures[0]);
            let sig1 = ethers_1.utils.splitSignature(appointment.stateUpdate.signatures[1]);
            // PISA: order the sigs dont expect them to be in a correct order - or do, explicitly
            const tx = yield contract.setstate([sig0.v - 27, sig0.r, sig0.s, sig1.v - 27, sig1.r, sig1.s], appointment.stateUpdate.round, appointment.stateUpdate.hashState);
            return yield tx.wait();
        });
    }
    static participants(contract) {
        return __awaiter(this, void 0, void 0, function* () {
            return [yield contract.plist(0), yield contract.plist(1)];
        });
    }
    static round(contract) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield contract.bestRound();
        });
    }
    static disputePeriod(contract) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield contract.disputePeriod();
        });
    }
    static status(contract) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield contract.status();
        });
    }
}
KitsuneTools.disputeEvent = "EventDispute(uint256)";
KitsuneTools.ContractBytecode = StateChannel.bytecode;
KitsuneTools.ContractAbi = StateChannel.abi;
exports.KitsuneTools = KitsuneTools;
