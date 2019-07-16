import { ethers } from "ethers";
import { BigNumber } from "ethers/utils";

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

export interface TransactionStub {
    blockNumber?: number;
    nonce: number;
    to?: string;
    from: string;
    chainId: number;
    data: string;
    value: BigNumber;
    gasLimit: BigNumber;
}

export interface ResponderBlock extends IBlockStub {
    transactions: TransactionStub[];
}

export interface Block extends IBlockStub, Logs, Transactions, TransactionHashes {}
