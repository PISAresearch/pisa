import RaidenContracts from "./raiden_data.json";
import RaidenBytecode from "./raidenBytecode.json";

export class RaidenTools {
    public static ContractAbi = RaidenContracts.contracts.TokenNetwork.abi;
    // PISA: need the actual bytecode as well as custom5
    public static ContractDeployedBytecode = RaidenBytecode.custom5;
}
