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

    public static encodeForUpdate(
        channelIdentifier: number,
        closingParticipant: string,
        nonClosingParticipant: string,
        balanceHash: string,
        nonce: number,
        additionalHash: string,
        closingSignature: string,
        nonClosingSignature: string
    ) {
        const args = [
            channelIdentifier,
            closingParticipant,
            nonClosingParticipant,
            balanceHash,
            nonce,
            additionalHash,
            closingSignature,
            nonClosingSignature
        ];

        // updateNonClosingBalanceProof
        // uint256 channel_identifier,
        // address closing_participant,
        // address non_closing_participant,
        // bytes32 balance_hash,
        // uint256 nonce,
        // bytes32 additional_hash,
        // bytes calldata closing_signature,
        // bytes calldata non_closing_signature

        const abi = new ethers.utils.Interface(RaidenTools.ContractAbi);
        const v = abi.functions["updateNonClosingBalanceProof"];
        return v.encode(args);
    }
}
