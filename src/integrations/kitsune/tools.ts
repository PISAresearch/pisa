import { solidityKeccak256 } from "ethers/utils";
import StateChannel from "./StateChannel.json";
import { ethers } from "ethers";

/**
 * A library of the Kitsune specific functionality
 */
export class KitsuneTools {
    public static hashForSetState(hState: string, round: number, channelAddress: string) {
        return solidityKeccak256(["bytes32", "uint256", "address"], [hState, round, channelAddress]);
    }
    public static ContractBytecode = StateChannel.bytecode;
    public static ContractDeployedBytecode = StateChannel.deployedBytecode;
    public static ContractAbi = StateChannel.abi;

    public static packData(hashState: string, round: number, sig0: string, sig1: string) {
        const sig0Split = ethers.utils.splitSignature(sig0);
        const sig1Split = ethers.utils.splitSignature(sig1);
        const packed = ethers.utils.solidityPack(
            ["uint256[]", "uint256", "bytes32"],
            [
                [sig0Split.v! - 27, sig0Split.r, sig0Split.s, sig1Split.v! - 27, sig1Split.r, sig1Split.s],
                round,
                hashState
            ]
        );
        return packed;
    }

    public static eventArgs() {
        // TODO:173: 0?
        return ethers.utils.solidityPack(["uint256"], [ 0 ]);
    }
}
