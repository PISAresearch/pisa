import RaidenContracts from "./raiden_data.json";
import RaidenBytecode from "./raidenBytecode.json";
import { ethers } from "ethers";

export class RaidenTools {
    public static ContractAbi = RaidenContracts.contracts.TokenNetwork.abi;
    public static ContractDeployedBytecode = RaidenBytecode.custom5;

    public static eventSignature: "ChannelClosed(uint256, address, uint256)";

    public static topics(channelIdentifier: number, closingParticipant: string) {
        const iFace = new ethers.utils.Interface(this.ContractAbi);
        return iFace.events["EventDispute"].encodeTopics([channelIdentifier, closingParticipant]);
    }
}
