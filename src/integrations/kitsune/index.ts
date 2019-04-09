import { utils, ethers } from "ethers";
import { KitsuneTools } from "./tools";
export { KitsuneTools } from "./tools";
import {
    Appointment,
    ChannelType,
    propertyExistsAndIsOfType,
    doesPropertyExist,
    isArrayOfStrings,
    PublicDataValidationError,
    checkAppointment
} from "../../dataEntities";
import { Inspector } from "../../inspector";
import { PublicInspectionError, ConfigurationError } from "../../dataEntities/errors";
import { verifyMessage } from "ethers/utils";
import logger from "../../logger";

/**
 * Format of a kitsune state update
 */
export interface IKitsuneStateUpdate {
    signatures: string[];
    hashState: string;
    round: number;
    contractAddress: string;
}

/**
 * An appointment containing kitsune specific information
 */
export class KitsuneAppointment extends Appointment {
    constructor(obj: { stateUpdate: IKitsuneStateUpdate; expiryPeriod: number; type: ChannelType.Kitsune });
    constructor(obj: any) {
        if (KitsuneAppointment.checkKitsuneAppointment(obj)) {
            super(obj.expiryPeriod, ChannelType.Kitsune);
            this.stateUpdate = obj.stateUpdate;
        } else throw new ConfigurationError("User defined type guard failed to throw for KitsuneAppointment");
    }
    public readonly stateUpdate: IKitsuneStateUpdate;

    private static checkKitsuneAppointment(obj: any): obj is KitsuneAppointment {
        checkAppointment(obj, ChannelType.Kitsune);
        doesPropertyExist("stateUpdate", obj);
        KitsuneAppointment.checkKitsuneStateUpdate(obj["stateUpdate"]);

        return true;
    }

    private static checkKitsuneStateUpdate(obj: any) {
        if (!obj) throw new PublicDataValidationError("stateUpdate does not exist.");
        propertyExistsAndIsOfType("hashState", "string", obj);
        const hexLength = utils.hexDataLength(obj.hashState);
        if (hexLength !== 32) {
            throw new PublicDataValidationError(`Invalid bytes32: ${obj.hashState}`);
        }

        propertyExistsAndIsOfType("round", "number", obj);
        propertyExistsAndIsOfType("contractAddress", "string", obj);
        try {
            // is this a valid address?
            utils.getAddress(obj.contractAddress);
        } catch (doh) {
            throw new PublicDataValidationError(`${obj.contractAddress} is not a valid address.`);
        }

        doesPropertyExist("signatures", obj);
        isArrayOfStrings(obj["signatures"]);
    }

    getStateNonce() {
        return this.stateUpdate.round;
    }

    getContractAddress() {
        return this.stateUpdate.contractAddress;
    }

    getStateLocator() {
        // in the kitsune paradigm a new contract is created for each state channel
        // and a single nonce is kept per channel

        return this.stateUpdate.contractAddress;
    }

    getEventFilter(contract: ethers.Contract) {
        return contract.filters.EventDispute(null);
    }

    getEventName() {
        return "EventDispute(uint256)";
    }

    getContractAbi() {
        return KitsuneTools.ContractAbi;
    }

    getSubmitStateFunction(): (contract: ethers.Contract) => Promise<void> {
        return async (contract: ethers.Contract) => {
            let sig0 = utils.splitSignature(this.stateUpdate.signatures[0]);
            let sig1 = utils.splitSignature(this.stateUpdate.signatures[1]);

            return await contract.setstate(
                [sig0.v - 27, sig0.r, sig0.s, sig1.v - 27, sig1.r, sig1.s],
                this.stateUpdate.round,
                this.stateUpdate.hashState
            );
        };
    }
}

/**
 * Responsible for deciding whether to accept Kitsune appointments
 */
export class KitsuneInspector extends Inspector<KitsuneAppointment> {
    constructor(public readonly minimumDisputePeriod: number, public readonly provider: ethers.providers.Provider) {
        super(ChannelType.Kitsune);
    }

    /**
     * Inspects an appointment to decide whether to accept it. Throws on reject.
     * @param appointment
     */
    public async checkInspection(appointment: KitsuneAppointment) {
        const contractAddress: string = appointment.stateUpdate.contractAddress;

        const code: string = await this.provider.getCode(contractAddress);
        // check that the channel is a contract
        if (!code || code === "0x" ) {
            throw new PublicInspectionError(`No code found at address ${contractAddress}.`);
        }
        if (code != KitsuneTools.ContractDeployedBytecode) {
            throw new PublicInspectionError(`Contract at: ${contractAddress} does not have correct bytecode.`);
        }

        // create a contract reference
        const contract: ethers.Contract = new ethers.Contract(contractAddress, KitsuneTools.ContractAbi, this.provider);

        // verify the appointment
        await this.verifyAppointment(
            appointment,
            appointment.stateUpdate.signatures,
            contract,
            appointment.stateUpdate.round,
            appointment.stateUpdate.hashState,
            this.minimumDisputePeriod
        );

        // an additional check to help the client, and the perception of PISA -
        // this isn't strictly necessary but it might catch some mistakes
        // if a client submits a request for an appointment that will always expire before a dispute can complete then
        // there is never any recourse against PISA.
        const channelDisputePeriod: number = await contract.disputePeriod();
        if (appointment.expiryPeriod <= channelDisputePeriod) {
            throw new PublicInspectionError(
                `Supplied appointment expiryPeriod ${
                    appointment.expiryPeriod
                } is not greater than the channel dispute period ${channelDisputePeriod}.`
            );
        }
    }

    /**
     * ******** SPEC **********
     * VerifyAppointment implements the spec described in the paper
     * http://www0.cs.ucl.ac.uk/staff/P.McCorry/pisa.pdf
     * @param signatures
     * @param contract
     * @param appointmentRound
     * @param hState
     * @param minimumDisputePeriod
     */
    public async verifyAppointment(
        appointment: KitsuneAppointment,
        signatures: string[],
        contract: ethers.Contract,
        appointmentRound: number,
        hState: string,
        minimumDisputePeriod: number
    ) {
        // check that the channel round is greater than the current round
        const currentChannelRound: number = await contract.bestRound();
        logger.info(appointment.formatLog(`On-chain round: ${currentChannelRound}`));
        if (appointmentRound <= currentChannelRound) {
            throw new PublicInspectionError(
                `Supplied appointment round ${appointmentRound} is not greater than channel round ${currentChannelRound}.`
            );
        }

        // check that the channel has a reasonable dispute period
        const channelDisputePeriod: number = await contract.disputePeriod();
        logger.info(appointment.formatLog(`On-chain dispute period: ${channelDisputePeriod}.`));
        if (channelDisputePeriod <= minimumDisputePeriod) {
            throw new PublicInspectionError(
                `Channel dispute period ${channelDisputePeriod} is less than or equal the minimum acceptable dispute period ${minimumDisputePeriod}.`
            );
        }

        // check that the channel is currently in the ON state
        const channelStatus: number = await contract.status();
        logger.info(appointment.formatLog(`On-chain channel status: ${channelStatus}.`));
        // ON = 0, DISPUTE = 1, OFF = 2
        if (channelStatus != 0) {
            throw new PublicInspectionError(`Channel status is ${channelStatus} not 0.`);
        }

        //verify all the signatures
        // get the participants
        let participants: string[] = (await [await contract.plist(0), await contract.plist(1)]) as string[];
        logger.info(appointment.formatLog(`On-chain participants: ${JSON.stringify(participants)}.`));

        // form the hash
        const setStateHash = KitsuneTools.hashForSetState(hState, appointmentRound, contract.address);

        // check the sigs
        this.verifySignatures(participants, setStateHash, signatures);
        logger.info(appointment.formatLog("All participants have signed."));
    }

    /**
     * Check that every participant that every participant has signed the message.
     * @param message
     * @param participants
     * @param sigs
     */
    private verifySignatures(participants: string[], message: string, sigs: string[]) {
        if (participants.length !== sigs.length) {
            throw new PublicInspectionError(
                `Incorrect number of signatures supplied. Participants: ${participants.length}, signers: ${
                    sigs.length
                }.`
            );
        }

        const signers = sigs.map(sig => verifyMessage(ethers.utils.arrayify(message), sig));
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
