// import {
//     EthereumAppointment,
//     ChannelType,
//     checkAppointment,
//     propertyExistsAndIsOfType,
//     doesPropertyExist,
//     PublicDataValidationError,
// } from "../../dataEntities";
// import { ethers, utils } from "ethers";
// import { RaidenTools } from "./tools";
// export { RaidenTools } from "./tools";
// import { verifyMessage } from "ethers/utils";
// import { BalanceProofSigGroup } from "./balanceProof";
// import logger from "../../logger";
// import { Inspector } from "../../inspector";
// import { PublicInspectionError } from "../../dataEntities";

// /**
//  * Format of a raiden state update
//  */
// interface IRaidenStateUpdate {
//     channel_identifier: number;
//     closing_participant: string;
//     non_closing_participant: string;
//     balance_hash: string;
//     nonce: number;
//     additional_hash: string;
//     closing_signature: string;
//     non_closing_signature: string;
//     chain_id: number;
//     token_network_identifier: string;
// }

// /**
//  * An appointment containing Raiden specific information
//  */
// export class RaidenAppointment extends EthereumAppointment {
//     constructor(obj: { stateUpdate: IRaidenStateUpdate; expiryPeriod: number; type: ChannelType.Raiden });
//     constructor(obj: any) {
//         if (RaidenAppointment.checkRaidenAppointment(obj)) {
//             super(obj.expiryPeriod, ChannelType.Raiden, obj.startBlock, obj.endBlock);
//             this.stateUpdate = obj.stateUpdate;
//         }
//     }
//     public readonly stateUpdate: IRaidenStateUpdate;

//     private static checkRaidenAppointment(obj: any): obj is RaidenAppointment {
//         checkAppointment(obj, ChannelType.Raiden);
//         doesPropertyExist("stateUpdate", obj);
//         RaidenAppointment.checkRaidenStateUpdate(obj["stateUpdate"]);

//         return true;
//     }

//     private static checkRaidenStateUpdate(obj: any) {
//         if (!obj) throw new PublicDataValidationError("stateUpdate does not exist.");
//         propertyExistsAndIsOfType("additional_hash", "string", obj);
//         const hexLength = utils.hexDataLength(obj.additional_hash);
//         if (hexLength !== 32) {
//             throw new PublicDataValidationError(`Invalid bytes32: ${obj.additional_hash}`);
//         }

//         propertyExistsAndIsOfType("balance_hash", "string", obj);
//         const balanceHexLength = utils.hexDataLength(obj.balance_hash);
//         if (balanceHexLength !== 32) {
//             throw new PublicDataValidationError(`Invalid bytes32: ${obj.balanceHexLength}`);
//         }

//         propertyExistsAndIsOfType("channel_identifier", "number", obj);

//         propertyExistsAndIsOfType("closing_participant", "string", obj);
//         try {
//             // is this a valid address?
//             utils.getAddress(obj.closing_participant);
//         } catch (doh) {
//             throw new PublicDataValidationError(`${obj.closing_participant} is not a valid address.`);
//         }

//         propertyExistsAndIsOfType("closing_signature", "string", obj);

//         propertyExistsAndIsOfType("non_closing_participant", "string", obj);
//         try {
//             // is this a valid address?
//             utils.getAddress(obj.non_closing_participant);
//         } catch (doh) {
//             throw new PublicDataValidationError(`${obj.non_closing_participant} is not a valid address.`);
//         }

//         propertyExistsAndIsOfType("non_closing_signature", "string", obj);

//         propertyExistsAndIsOfType("nonce", "number", obj);
//         propertyExistsAndIsOfType("chain_id", "number", obj);

//         propertyExistsAndIsOfType("token_network_identifier", "string", obj);
//         try {
//             // is this a valid address?
//             utils.getAddress(obj.token_network_identifier);
//         } catch (doh) {
//             throw new PublicDataValidationError(`${obj.token_network_identifier} is not a valid address.`);
//         }
//     }

//     public getStateNonce() {
//         return this.stateUpdate.nonce;
//     }

//     public getContractAddress() {
//         return this.stateUpdate.token_network_identifier;
//     }

//     public getStateLocator() {
//         // the raiden network has one contract per token - the token network
//         // within this contract each pair of participants can have at most one channel between them - the channel identifier
//         // within this channel each participant keeps a record of the state of how much they are owed by their counterparty
//         // it is this balance that is submitted to pisa

//         return `${this.stateUpdate.token_network_identifier}:${this.stateUpdate.channel_identifier}:${
//             this.stateUpdate.closing_participant
//         }`;
//     }

//     public getEventFilter(): ethers.EventFilter {
//         let event = new ethers.utils.Interface(this.getContractAbi());
//         let topics = event.events["ChannelClosed"].encodeTopics([this.stateUpdate.channel_identifier, this.stateUpdate.closing_participant, null]);

//         return {
//             address: this.getContractAddress(),
//             topics
//         }
//     }

//     public getEventName() {
//         return `ChannelClosed(${this.stateUpdate.channel_identifier},${this.stateUpdate.closing_participant},uint256)`;
//     }

//     public getContractAbi() {
//         return RaidenTools.ContractAbi;
//     }

//     public getResponseFunctionName(): string {
//         return "updateNonClosingBalanceProof";
//     }

//     public getResponseFunctionArgs(): any[] {
//         return [
//             this.stateUpdate.channel_identifier,
//             this.stateUpdate.closing_participant,
//             this.stateUpdate.non_closing_participant,
//             this.stateUpdate.balance_hash,
//             this.stateUpdate.nonce,
//             this.stateUpdate.additional_hash,
//             this.stateUpdate.closing_signature,
//             this.stateUpdate.non_closing_signature
//         ]
//     }
// }

// /**
//  * Responsible for deciding whether to accept appointments
//  */
// export class RaidenInspector extends Inspector<RaidenAppointment> {
//     constructor(private readonly minimumDisputePeriod: number, provider: ethers.providers.Provider) {
//         super(ChannelType.Raiden, provider);
//     }

//     /**
//      * Inspects an appointment to decide whether to accept it. Throws on reject.
//      * @param appointment
//      */
//     public async checkInspection(appointment: RaidenAppointment) {
//         const contractAddress: string = appointment.stateUpdate.token_network_identifier;

//         const code: string = await this.provider.getCode(contractAddress);
//         // check that the channel is a contract
//         if (!code || code === "0x") {
//             throw new PublicInspectionError(`No code found at address ${contractAddress}`);
//         }

//         if (code != RaidenTools.ContractDeployedBytecode) {
//             throw new PublicInspectionError(`Contract at: ${contractAddress} does not have correct bytecode.`);
//         }

//         // create a contract reference
//         const contract: ethers.Contract = new ethers.Contract(contractAddress, RaidenTools.ContractAbi, this.provider);

//         // verify the appointment
//         ///////////////////////////////////////////////////////////////////////////////////////////////////////////
//         ////////////////////////// COPIED FROM THE VERIFY APPOINTMENT SECTION /////////////////////////////////////
//         ///////////////////////////////////////////////////////////////////////////////////////////////////////////
//         /// AND ADJUSTED FOR RAIDEN

//         // check that the channel round is greater than the current round
//         // get the channel identifier, and the participant info for the counterparty

//         const participantInfo = await contract.functions.getChannelParticipantInfo(
//             appointment.stateUpdate.channel_identifier,
//             appointment.stateUpdate.closing_participant,
//             appointment.stateUpdate.non_closing_participant
//         );
//         const nonce = participantInfo[4];
//         const channelInfo = await contract.functions.getChannelInfo(
//             appointment.stateUpdate.channel_identifier,
//             appointment.stateUpdate.closing_participant,
//             appointment.stateUpdate.non_closing_participant
//         );
//         const channelDisputePeriod = channelInfo[0];
//         const channelStatus = channelInfo[1];

//         logger.info(appointment.formatLog(`On-chain round: ${nonce.toString(10)}.`));
//         if (appointment.stateUpdate.nonce <= nonce) {
//             throw new PublicInspectionError(
//                 `Supplied appointment round ${appointment.stateUpdate.nonce} is not greater than channel round ${nonce}`
//             );
//         }

//         // check that the channel is currently in the ON state
//         logger.info(appointment.formatLog(`On-chain status: ${channelStatus}.`));

//         //     NonExistent, // 0
//         //     Opened,      // 1
//         //     Closed,      // 2
//         //     Settled,     // 3
//         //     Removed      // 4
//         if (channelStatus != 1) {
//             throw new PublicInspectionError(`Channel status is ${channelStatus} not "Opened".`);
//         }

//         //check that the channel has a reasonable dispute period

//         // settle block number is used for two purposes:
//         // 1) It is initially populated with a settle_timeout
//         // 2) When closeChannel is called it is updated with += block.number
//         // we've checked that the status is correct - so we must be in situation 1)
//         logger.info(appointment.formatLog(`On-chain dispute period: ${channelDisputePeriod.toString(10)}.`));
//         if (channelDisputePeriod <= this.minimumDisputePeriod) {
//             throw new PublicInspectionError(
//                 `Channel dispute period ${channelDisputePeriod} is less than or equal the minimum acceptable dispute period ${
//                     this.minimumDisputePeriod
//                 }.`
//             );
//         }

//         // an additional check to help the client, and the perception of PISA -
//         // this isn't strictly necessary but it might catch some mistakes
//         // if a client submits a request for an appointment that will always expire before a dispute can complete then
//         // there is never any recourse against PISA.
//         const currentBlockNumber = await this.provider.getBlockNumber();
//         if (appointment.expiryPeriod <= channelDisputePeriod - currentBlockNumber) {
//             throw new PublicInspectionError(
//                 `Supplied appointment expiryPeriod ${
//                     appointment.expiryPeriod
//                 } is not greater than the channel dispute period ${channelDisputePeriod}.`
//             );
//         }

//         // form the data required to verify raiden sigs
//         let sigGroup: BalanceProofSigGroup = new BalanceProofSigGroup(
//             appointment.stateUpdate.token_network_identifier,
//             appointment.stateUpdate.chain_id,
//             appointment.stateUpdate.channel_identifier,
//             appointment.stateUpdate.balance_hash,
//             appointment.stateUpdate.nonce,
//             appointment.stateUpdate.additional_hash,
//             appointment.stateUpdate.closing_signature
//         );

//         // a) did the non closing participant sign the message?
//         let nonClosingAccount = verifyMessage(
//             ethers.utils.arrayify(sigGroup.packForNonCloser()),
//             appointment.stateUpdate.non_closing_signature
//         );
//         if (appointment.stateUpdate.non_closing_participant !== nonClosingAccount) {
//             throw new PublicInspectionError(
//                 `Supplied non_closing_signature was created by account ${nonClosingAccount}, not account ${
//                     appointment.stateUpdate.non_closing_participant
//                 }.`
//             );
//         }

//         // b) did the closing participant sign the message?
//         let closingAccount = verifyMessage(
//             ethers.utils.arrayify(sigGroup.packForCloser()),
//             appointment.stateUpdate.closing_signature
//         );
//         if (appointment.stateUpdate.closing_participant !== closingAccount) {
//             throw new PublicInspectionError(
//                 `Supplied closing_signature was created by account ${closingAccount}, not account ${
//                     appointment.stateUpdate.closing_participant
//                 }.`
//             );
//         }

//         logger.info(appointment.formatLog("All participants have signed."));
//         ///////////////////////////////////////////////////////////////////////////////////////////////////////////
//         ///////////////////////////////////////////////////////////////////////////////////////////////////////////
//         ///////////////////////////////////////////////////////////////////////////////////////////////////////////
//     }
// }
