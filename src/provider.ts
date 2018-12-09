import Ganache from "ganache-core";
import { ethers } from "ethers";
import { IConfig } from "./dataEntities/config";
const config = require("./config.json") as IConfig;

// provide the ability to get different providers

export const getGanacheProvider = () => {
  const ganache = Ganache.provider({
    mnemonic:
      "myth like bonus scare over problem client lizard pioneer submit female collect"
  });
  const ganacheProvider = new ethers.providers.Web3Provider(ganache);
  ganacheProvider.pollingInterval = 100;
  return ganache;
};

export const getJsonRPCProvider = () => {
  return new ethers.providers.JsonRpcProvider(config.jsonRpcUrl);
};

export const getInfuraProvider = (): ethers.providers.InfuraProvider => {
  const infura: any = config.infura;

  const infuraProvider = new ethers.providers.InfuraProvider(
    config.infura.currentNetwork,
    infura[`${config.infura.currentNetwork}`].apikey
  );

  return infuraProvider;
};

export async function validateProviders(local: boolean = false) {
  let provider = 0;
  try {
    if (local) {
      await getInfuraProvider().getTransactionCount(
        "0xD115BFFAbbdd893A6f7ceA402e7338643Ced44a6"
      );
      ++provider;
      await getJsonRPCProvider().getTransactionCount(
        "0xD115BFFAbbdd893A6f7ceA402e7338643Ced44a6"
      );
    } else {
      await getInfuraProvider().getTransactionCount(
        "0xD115BFFAbbdd893A6f7ceA402e7338643Ced44a6"
      );
    }
  } catch (err) {
    throw new Error(`Provider ${provider} failed to connect: ${err}`);
  }
}
