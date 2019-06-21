import { ethers } from "ethers";

export interface IBlockStub {
    hash: string;
    number: number;
    parentHash: string;
}

export interface Logs {
    logs: ethers.providers.Log[];
}

export interface Transactions {
    transactions: string[];
}

export interface Block extends IBlockStub, Logs, Transactions {}
