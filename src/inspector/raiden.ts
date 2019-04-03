import { RaidenAppointment, ChannelType } from "../dataEntities";
import { ethers } from "ethers";
import { verifyMessage } from "ethers/utils";
import { BalanceProofSigGroup } from "../integrations/raiden/balanceProof";
import logger from "../logger";
import RaidenTools from "../integrations/raiden/tools";
import { Inspector } from "./inspector";
import { PublicInspectionError } from "../dataEntities/errors"

/**
 * Responsible for deciding whether to accept appointments
 */
export class RaidenInspector extends Inspector {
    constructor(private readonly minimumDisputePeriod: number, private readonly provider: ethers.providers.Provider) {
        super(ChannelType.Raiden)
    }

    /**
     * Inspects an appointment to decide whether to accept it. Throws on reject.
     * @param appointment
     */
    public async checkInspection(appointment: RaidenAppointment) {
        const contractAddress: string = appointment.stateUpdate.token_network_identifier;

        const code: string = await this.provider.getCode(contractAddress);
        // check that the channel is a contract
        if (code === "0x" || code === "0x00") {
            throw new PublicInspectionError(`No code found at address ${contractAddress}`);
        }
        // PISA: include this check for raiden
        // if (code != this.deployedBytecode) {
        //     throw new PublicInspectionError(`Contract at: ${contractAddress} does not have correct bytecode.`);
        // }

        // create a contract reference
        const contract: ethers.Contract = new ethers.Contract(contractAddress, RaidenTools.ContractAbi, this.provider);

        // verify the appointment
        ///////////////////////////////////////////////////////////////////////////////////////////////////////////
        ////////////////////////// COPIED FROM THE VERIFY APPOINTMENT SECTION /////////////////////////////////////
        ///////////////////////////////////////////////////////////////////////////////////////////////////////////
        /// AND ADJUSTED FOR RAIDEN

        // check that the channel round is greater than the current round
        // get the channel identifier, and the participant info for the counterparty

        const participantInfo = await contract.getChannelParticipantInfo(
            appointment.stateUpdate.channel_identifier,
            appointment.stateUpdate.closing_participant,
            appointment.stateUpdate.non_closing_participant
        );
        const nonce = participantInfo[4];
        const channelInfo = await contract.getChannelInfo(
            appointment.stateUpdate.channel_identifier,
            appointment.stateUpdate.closing_participant,
            appointment.stateUpdate.non_closing_participant
        );
        const settleBlockNumber = channelInfo[0];
        const status = channelInfo[1];

        logger.info(appointment.formatLogEvent(`On-chain round: ${nonce.toString(10)}.`));
        if (appointment.stateUpdate.nonce <= nonce) {
            throw new PublicInspectionError(
                `Supplied appointment round ${
                    appointment.stateUpdate.nonce
                } is not greater than channel round ${nonce}`
            );
        }

        // check that the channel is currently in the ON state
        // PISA: await?
        const channelStatus: number = await status;
        logger.info(appointment.formatLogEvent(`On-chain status: ${channelStatus}.`));

        //     NonExistent, // 0
        //     Opened,      // 1
        //     Closed,      // 2
        //     Settled,     // 3
        //     Removed      // 4
        if (channelStatus != 1) {
            throw new PublicInspectionError(`Channel status is ${channelStatus} not "Opened".`);
        }

        //check that the channel has a reasonable dispute period

        // settle block number is used for two purposes:
        // 1) It is initially populated with a settle_timeout
        // 2) When closeChannel is called it is updated with += block.number
        // we've checked that the status is correct - so we must be in situation 1)
        const channelDisputePeriod: number = await settleBlockNumber;
        logger.info(appointment.formatLogEvent(`On-chain dispute period: ${channelDisputePeriod.toString(10)}.`));
        if (channelDisputePeriod <= this.minimumDisputePeriod) {
            throw new PublicInspectionError(
                `Channel dispute period ${channelDisputePeriod} is less than or equal the minimum acceptable dispute period ${
                    this.minimumDisputePeriod
                }.`
            );
        }

        // an additional check to help the client, and the perception of PISA -
        // this isn't strictly necessary but it might catch some mistakes
        // if a client submits a request for an appointment that will always expire before a dispute can complete then
        // there is never any recourse against PISA.
        const currentBlockNumber = await this.provider.getBlockNumber();
        if (appointment.expiryPeriod <= channelDisputePeriod - currentBlockNumber) {
            throw new PublicInspectionError(
                `Supplied appointment expiryPeriod ${
                    appointment.expiryPeriod
                } is not greater than the channel dispute period ${channelDisputePeriod}.`
            );
        }

        // form the data required to verify raiden sigs
        let sigGroup: BalanceProofSigGroup = new BalanceProofSigGroup(
            appointment.stateUpdate.token_network_identifier,
            appointment.stateUpdate.chain_id,
            appointment.stateUpdate.channel_identifier,
            appointment.stateUpdate.balance_hash,
            appointment.stateUpdate.nonce,
            appointment.stateUpdate.additional_hash,
            appointment.stateUpdate.closing_signature
        );

        // a) did the non closing participant sign the message?
        let nonClosingAccount = verifyMessage(
            ethers.utils.arrayify(sigGroup.packForNonCloser()),
            appointment.stateUpdate.non_closing_signature
        );
        if (appointment.stateUpdate.non_closing_participant !== nonClosingAccount) {
            throw new PublicInspectionError(
                `Supplied non_closing_signature was created by account ${nonClosingAccount}, not account ${
                    appointment.stateUpdate.non_closing_participant
                }.`
            );
        }

        // b) did the closing participant sign the message?
        let closingAccount = verifyMessage(
            ethers.utils.arrayify(sigGroup.packForCloser()),
            appointment.stateUpdate.closing_signature
        );
        if (appointment.stateUpdate.closing_participant !== closingAccount) {
            throw new PublicInspectionError(
                `Supplied closing_signature was created by account ${closingAccount}, not account ${
                    appointment.stateUpdate.closing_participant
                }.`
            );
        }

        logger.info(appointment.formatLogEvent("All participants have signed."));
        ///////////////////////////////////////////////////////////////////////////////////////////////////////////
        ///////////////////////////////////////////////////////////////////////////////////////////////////////////
        ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    }
}
