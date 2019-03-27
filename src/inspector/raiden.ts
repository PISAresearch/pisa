import { RaidenAppointmentRequest, RaidenAppointment, ChannelType } from "../dataEntities/appointment";
import { ethers } from "ethers";
import { verifyMessage } from "ethers/utils";
import { BalanceProofSigGroup } from "../balanceProof";
import logger from "../logger";
import RaidenContracts from "../raiden_data.json";
import { PublicInspectionError, IInspector } from "../inspector/inspector";
const tokenNetworkAbi = RaidenContracts.contracts.TokenNetwork.abi;

/**
 * Responsible for deciding whether to accept appointments
 */
export class RaidenInspector implements IInspector {
    constructor(private readonly minimumDisputePeriod: number, private readonly provider: ethers.providers.Provider) {}
    public readonly channelType = ChannelType.Raiden;

    /**
     * Inspects an appointment to decide whether to accept it. Throws on reject.
     * @param appointmentRequest
     */
    public async inspect(appointmentRequest: RaidenAppointmentRequest) {
        const contractAddress: string = appointmentRequest.stateUpdate.token_network_identifier;

        // log the appointment we're inspecting
        logger.info(
            `Inspecting appointment ${
                appointmentRequest.stateUpdate.channel_identifier
            } for contract ${contractAddress}.`
        );
        logger.debug("Appointment request: " + JSON.stringify(appointmentRequest));
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
        const contract: ethers.Contract = new ethers.Contract(contractAddress, tokenNetworkAbi, this.provider);

        // verify the appointment
        ///////////////////////////////////////////////////////////////////////////////////////////////////////////
        ////////////////////////// COPIED FROM THE VERIFY APPOINTMENT SECTION /////////////////////////////////////
        ///////////////////////////////////////////////////////////////////////////////////////////////////////////
        /// AND ADJUSTED FOR RAIDEN

        // check that the channel round is greater than the current round
        // get the channel identifier, and the participant info for the counterparty

        const participantInfo = await contract.getChannelParticipantInfo(
            appointmentRequest.stateUpdate.channel_identifier,
            appointmentRequest.stateUpdate.closing_participant,
            appointmentRequest.stateUpdate.non_closing_participant
        );
        const nonce = participantInfo[4];
        const channelInfo = await contract.getChannelInfo(
            appointmentRequest.stateUpdate.channel_identifier,
            appointmentRequest.stateUpdate.closing_participant,
            appointmentRequest.stateUpdate.non_closing_participant
        );
        const settleBlockNumber = channelInfo[0];
        const status = channelInfo[1];

        logger.info(`Round at ${contract.address}: ${nonce.toString(10)}`);
        if (appointmentRequest.stateUpdate.nonce <= nonce) {
            throw new PublicInspectionError(
                `Supplied appointment round ${
                    appointmentRequest.stateUpdate.nonce
                } is not greater than channel round ${nonce}`
            );
        }

        // check that the channel is currently in the ON state
        const channelStatus: number = await status;
        logger.info(`Channel status at ${contract.address}: ${JSON.stringify(channelStatus)}`);

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
        logger.info(`Dispute period at ${contract.address}: ${channelDisputePeriod.toString(10)}`);
        if (channelDisputePeriod <= this.minimumDisputePeriod) {
            throw new PublicInspectionError(
                `Channel dispute period ${channelDisputePeriod} is less than or equal the minimum acceptable dispute period ${
                    this.minimumDisputePeriod
                }`
            );
        }

        // an additional check to help the client, and the perception of PISA -
        // this isn't strictly necessary but it might catch some mistakes
        // if a client submits a request for an appointment that will always expire before a dispute can complete then
        // there is never any recourse against PISA.
        const currentBlockNumber = await this.provider.getBlockNumber();
        if (appointmentRequest.expiryPeriod <= channelDisputePeriod - currentBlockNumber) {
            throw new PublicInspectionError(
                `Supplied appointment expiryPeriod ${
                    appointmentRequest.expiryPeriod
                } is not greater than the channel dispute period ${channelDisputePeriod}`
            );
        }

        // form the data required to verify raiden sigs
        let sigGroup: BalanceProofSigGroup = new BalanceProofSigGroup(
            appointmentRequest.stateUpdate.token_network_identifier,
            appointmentRequest.stateUpdate.chain_id,
            appointmentRequest.stateUpdate.channel_identifier,
            appointmentRequest.stateUpdate.balance_hash,
            appointmentRequest.stateUpdate.nonce,
            appointmentRequest.stateUpdate.additional_hash,
            appointmentRequest.stateUpdate.closing_signature
        );

        // a) did the non closing participant sign the message?
        let nonClosingAccount = verifyMessage(
            ethers.utils.arrayify(sigGroup.packForNonCloser()),
            appointmentRequest.stateUpdate.non_closing_signature
        );
        if (appointmentRequest.stateUpdate.non_closing_participant !== nonClosingAccount) {
            throw new PublicInspectionError(
                `Supplied non_closing_signature was created by account ${nonClosingAccount}, not account ${
                    appointmentRequest.stateUpdate.non_closing_participant
                }`
            );
        }

        // b) did the closing participant sign the message?
        let closingAccount = verifyMessage(
            ethers.utils.arrayify(sigGroup.packForCloser()),
            appointmentRequest.stateUpdate.closing_signature
        );
        if (appointmentRequest.stateUpdate.closing_participant !== closingAccount) {
            throw new PublicInspectionError(
                `Supplied non_closing_signature was created by account ${closingAccount}, not account ${
                    appointmentRequest.stateUpdate.closing_participant
                }`
            );
        }

        logger.info("All participants have signed.");
        ///////////////////////////////////////////////////////////////////////////////////////////////////////////
        ///////////////////////////////////////////////////////////////////////////////////////////////////////////
        ///////////////////////////////////////////////////////////////////////////////////////////////////////////

        // here we want to
        const appointment = this.createAppointment(appointmentRequest);
        logger.debug("Appointment: ", appointment);
        return appointment;
    }

    /**
     * Converts an appointment request into an appointment
     * @param request
     */
    private createAppointment(request: RaidenAppointmentRequest): RaidenAppointment {
        const startTime = Date.now();

        // PISA: just factory this
        return new RaidenAppointment(request.stateUpdate, startTime, startTime + request.expiryPeriod, Date.now());
    }
}
