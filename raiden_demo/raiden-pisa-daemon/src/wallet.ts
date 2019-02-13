import * as fs from "fs";
import { ethers } from "ethers";

// load a local wallet
export const getWallet = async (keyFileLocation: string, password: string) => {
    const keyData = fs.readFileSync(keyFileLocation).toString();
    return await ethers.Wallet.fromEncryptedJson(keyData, password);
}