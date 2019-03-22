import { ethers } from "ethers";
import config from "./dataEntities/config";
// provide the ability to get different providers

export const getJsonRPCProvider = async (url?: string) => {
    const provider = new ethers.providers.JsonRpcProvider(url || config.jsonRpcUrl);
    provider.pollingInterval = 100;
    await validateProvider(provider);
    return provider;
};

export async function validateProvider(provider: ethers.providers.Provider) {
    try {
        /* if the provider is working then a valid response of a number will be returned
            otherwise, an error will be thrown such as invalid JSON response "" which indicates 
            the connection failed, the error will be caught here and a separate error will be thrown.
            The address is a random valid address taken from ethersjs documentation
        */
        await provider.getTransactionCount("0xD115BFFAbbdd893A6f7ceA402e7338643Ced44a6");
    } catch (err) {
        if ((provider as any).connection && (provider as any).connection.url) {
            throw new Error(`Provider failed to connect to ${(provider as any).connection.url}.\n ${err}`);
        } else throw new Error(`Provider ${JSON.stringify(provider)} failed to connect.\n ${err}`);
    }
}
