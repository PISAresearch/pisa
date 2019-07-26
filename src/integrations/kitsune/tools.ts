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

    public static encodeSetStateData(hashState: string, round: number, sig0: string, sig1: string) {
        const s0 = ethers.utils.splitSignature(sig0);
        const s1 = ethers.utils.splitSignature(sig1);
        const q = [s0.v! - 27, s0.r, s0.s, s1.v! - 27, s1.r, s1.s];
        const args = [q, round, hashState];

        const abi = new ethers.utils.Interface(KitsuneTools.ContractAbi);
        const v = abi.functions["setstate"];
        return v.encode(args);
    }

    public static eventArgs() {
        // no indexed args specified
        return ethers.utils.defaultAbiCoder.encode(["uint256[]"], [[]]);
    }

    public static eventABI() {
        return "event EventDispute(uint256 indexed)";
    }
}
