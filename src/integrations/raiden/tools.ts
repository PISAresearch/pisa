import RaidenContracts from "./raiden_data.json";
import RaidenBytecode from "./raidenBytecode.json";
import { ethers } from "ethers";

export class RaidenTools {
    public static ContractAbi = RaidenContracts.contracts.TokenNetwork.abi;
    public static ContractDeployedBytecode = RaidenBytecode.custom5;

    public static eventArgs(channelIdentifier: number, closingParticipant: string) {
        return ethers.utils.defaultAbiCoder.encode(
            ["uint256[]", "uint256", "address"],
            [[0, 1], channelIdentifier, closingParticipant]
        );
    }

    public static eventABI() {
        return "event ChannelClosed(uint256 indexed, address indexed, uint256 indexed);";
    }
}
