import { ethers } from "ethers";

export interface IBlockStub {
    hash: string;
    number: number;
    parentHash: string;
}

export interface Logs {
    logs: ethers.providers.Log[];
}

export interface TransactionHashes {
    transactionHashes: string[];
}

export interface Transactions {
    transactions: ethers.providers.TransactionResponse[];
}

export interface Block extends IBlockStub, Logs, Transactions, TransactionHashes {}
