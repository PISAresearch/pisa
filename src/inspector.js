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
const kitsuneTools_1 = require("./kitsuneTools");
const ethers_1 = require("ethers");
const utils_1 = require("ethers/utils");
const logger_1 = __importDefault(require("./logger"));
/**
 * Responsible for deciding whether to accept appointments
 */
class Inspector {
    constructor(minimumDisputePeriod, provider, channelAbi, hashForSetState, participants, round, disputePeriod, status) {
        this.minimumDisputePeriod = minimumDisputePeriod;
        this.provider = provider;
        this.channelAbi = channelAbi;
        this.hashForSetState = hashForSetState;
        this.participants = participants;
        this.round = round;
        this.disputePeriod = disputePeriod;
        this.status = status;
    }
    /**
     * Inspects an appointment to decide whether to accept it. Throws on reject.
     * @param appointmentRequest
     */
    inspect(appointmentRequest) {
        return __awaiter(this, void 0, void 0, function* () {
            // log the appointment we're inspecting
            logger_1.default.info(`Inspecting appointment ${appointmentRequest.stateUpdate.hashState} for contract ${appointmentRequest.stateUpdate.contractAddress}.`);
            logger_1.default.debug("Appointment request: " + JSON.stringify(appointmentRequest));
            let code = yield this.provider.getCode(appointmentRequest.stateUpdate.contractAddress);
            if (code === "0x00") {
                throw new PublicInspectionError(`No code found at address ${appointmentRequest.stateUpdate.contractAddress}`);
            }
            // get the participants
            let contract;
            try {
                contract = new ethers_1.ethers.Contract(appointmentRequest.stateUpdate.contractAddress, this.channelAbi, this.provider);
            }
            catch (d) {
                console.error("AAAAA");
                console.error(d);
                throw d;
            }
            let participants;
            try {
                participants = yield this.participants(contract);
                logger_1.default.info(`Participants at ${contract.address}: ${JSON.stringify(participants)}`);
            }
            catch (d) {
                console.log("bbbbb");
                console.log(d);
                throw d;
            }
            // form the hash
            const setStateHash = this.hashForSetState(appointmentRequest.stateUpdate.hashState, appointmentRequest.stateUpdate.round, appointmentRequest.stateUpdate.contractAddress);
            // check the sigs
            this.checkAllSigned(setStateHash, participants, appointmentRequest.stateUpdate.signatures);
            logger_1.default.info("All participants have signed.");
            // check that the supplied state round is valid
            const channelRound = yield this.round(contract);
            logger_1.default.info(`Round at ${contract.address}: ${channelRound.toString(10)}`);
            if (channelRound >= appointmentRequest.stateUpdate.round) {
                throw new PublicInspectionError(`Supplied appointment round ${appointmentRequest.stateUpdate.round} is not greater than channel round ${channelRound}`);
            }
            // check that the channel is not in a dispute
            const channelDisputePeriod = yield this.disputePeriod(contract);
            logger_1.default.info(`Dispute period at ${contract.address}: ${channelDisputePeriod.toString(10)}`);
            if (appointmentRequest.expiryPeriod <= channelDisputePeriod) {
                throw new PublicInspectionError(`Supplied appointment expiryPeriod ${appointmentRequest.expiryPeriod} is not greater than the channel dispute period ${channelDisputePeriod}`);
            }
            // PISA: dispute period is a block number! we're comparing apples to oranges here
            if (channelDisputePeriod < this.minimumDisputePeriod) {
                throw new PublicInspectionError(`Channel dispute period ${channelDisputePeriod} is less than the minimum acceptable dispute period ${this.minimumDisputePeriod}`);
            }
            const channelStatus = yield this.status(contract);
            logger_1.default.info(`Channel status at ${contract.address}: ${JSON.stringify(channelStatus)}`);
            // ON = 0, DISPUTE = 1, OFF = 2
            if (channelStatus != 0) {
                throw new PublicInspectionError(`Channel status is ${channelStatus} not 0.`);
            }
            const appointment = this.createAppointment(appointmentRequest);
            logger_1.default.debug("Appointment: ", appointment);
            return appointment;
        });
    }
    /**
     * Converts an appointment request into an appointment
     * @param request
     */
    createAppointment(request) {
        const startTime = Date.now();
        return {
            stateUpdate: request.stateUpdate,
            startTime: startTime,
            endTime: startTime + request.expiryPeriod,
            inspectionTime: Date.now()
        };
    }
    /**
     * Check that every participant that every participant has signed the message.
     * @param message
     * @param participants
     * @param sigs
     */
    checkAllSigned(message, participants, sigs) {
        if (participants.length !== sigs.length) {
            throw new PublicInspectionError(`Incorrect number of signatures supplied. Participants: ${participants.length}, signers: ${sigs.length}.`);
        }
        const signers = sigs.map(sig => utils_1.verifyMessage(ethers_1.ethers.utils.arrayify(message), sig));
        participants.forEach(party => {
            const signerIndex = signers.map(m => m.toLowerCase()).indexOf(party.toLowerCase());
            if (signerIndex === -1) {
                throw new PublicInspectionError(`Party ${party} not present in signatures.`);
            }
            // remove the signer, so that we never look for it again
            signers.splice(signerIndex, 1);
        });
    }
}
exports.Inspector = Inspector;
/**
 * Contains error messages that are safe to expose publicly
 */
class PublicInspectionError extends Error {
    constructor(message) {
        super(message);
    }
}
exports.PublicInspectionError = PublicInspectionError;
class KitsuneInspector extends Inspector {
    constructor(disputePeriod, provider) {
        super(disputePeriod, provider, kitsuneTools_1.KitsuneTools.ContractAbi, kitsuneTools_1.KitsuneTools.hashForSetState, kitsuneTools_1.KitsuneTools.participants, kitsuneTools_1.KitsuneTools.round, kitsuneTools_1.KitsuneTools.disputePeriod, kitsuneTools_1.KitsuneTools.status);
    }
}
exports.KitsuneInspector = KitsuneInspector;
