import { solidityKeccak256 } from "ethers/utils";
import StateChannel from "./StateChannel.json";

/**
 * A library of the Kitsune specific functionality
 */
export default class KitsuneTools {
    public static hashForSetState(hState: string, round: number, channelAddress: string) {
        return solidityKeccak256(["bytes32", "uint256", "address"], [hState, round, channelAddress]);
    }
    public static ContractBytecode = StateChannel.bytecode;
    public static ContractDeployedBytecode = StateChannel.deployedBytecode;
    public static ContractAbi = StateChannel.abi;
}
