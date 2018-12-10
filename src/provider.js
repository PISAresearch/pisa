"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ganache_core_1 = __importDefault(require("ganache-core"));
const ethers_1 = require("ethers");
const config = require("./config.json");
// provide the ability to get different providers
const getGanacheProvider = () => {
    const ganache = ganache_core_1.default.provider({
        mnemonic: "myth like bonus scare over problem client lizard pioneer submit female collect"
    });
    const ganacheProvider = new ethers_1.ethers.providers.Web3Provider(ganache);
    ganacheProvider.pollingInterval = 100;
    return ganache;
};
const getInfuraProvider = () => {
    const infura = config.infura;
    const infuraProvider = new ethers_1.ethers.providers.InfuraProvider(config.infura.currentNetwork, infura[`${config.infura.currentNetwork}`].apikey);
    return infuraProvider;
};
