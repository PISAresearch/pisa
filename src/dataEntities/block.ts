import { ethers } from "ethers";

export interface IBlockStub {
    hash: string;
    number: number;
    parentHash: string;
}

export interface HasLogs {
    logs: ethers.providers.Log[]; // TODO: use own type?
}

export interface HasTxHashes {
    transactions: string[];
}

export interface Block extends IBlockStub, HasLogs, HasTxHashes {}
