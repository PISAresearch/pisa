import { ethers } from "ethers";
import * as PisaContract from "./../../../src/contractInfo/pisa";
import * as SosContract from "./../../smoke/SOSContract";
import * as DataRegistryContract from "./../../../src/contractInfo/dataRegistry";
import { wait } from "../../../src/utils";

export const deployPisa = async (watcherWallet: ethers.Wallet): Promise<ethers.Contract> => {
    
    const drContractFactory = new ethers.ContractFactory(
        DataRegistryContract.ABI,
        DataRegistryContract.ByteCode,
        watcherWallet
    );
    const drContract = await drContractFactory.deploy({ gasLimit: 6000000 });
    await drContract.deployed();

    const pisaContractFactory = new ethers.ContractFactory(PisaContract.ABI, PisaContract.ByteCode, watcherWallet);
    const pisaContract = await pisaContractFactory.deploy(drContract.address, 100, 0, watcherWallet.address, [], 0, {gasLimit: 6500000}); // prettier-ignore
    await pisaContract.deployed();

    // install a watcher
    const watcherInstallBlock = (await watcherWallet.provider.getBlockNumber()) + 2;
    const watcherInstallHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
            ["address", "uint", "address"],
            [watcherWallet.address, watcherInstallBlock, pisaContract.address]
        )
    );
    const sig = await watcherWallet.signMessage(ethers.utils.arrayify(watcherInstallHash));

    const tx = await pisaContract.installWatcher(watcherWallet.address, watcherInstallBlock, sig, { gasLimit: 5000000});
    await tx.wait(1);

    return pisaContract;
};
