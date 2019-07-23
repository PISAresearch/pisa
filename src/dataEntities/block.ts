import { ethers } from "ethers";
import { BigNumber } from "ethers/utils";
import { ArgumentError } from "./errors";

export interface IBlockStub {
    hash: string;
    number: number;
    parentHash: string;
}

export interface Logs {
    logs: ethers.providers.Log[];
}

/**
 * Returns true the `block` contains a log that matches `filter`, false otherwise.
 */
export function hasLogMatchingEventFilter(block: Logs, filter: ethers.EventFilter): boolean {
    if (!filter.address) throw new ArgumentError("The filter must provide an address");
    if (!filter.topics) throw new ArgumentError("The filter must provide the topics");

    return block.logs.some(
        log =>
            log.address.toLowerCase() === filter.address!.toLowerCase() &&
            filter.topics!.every((topic, idx) => log.topics[idx].toLowerCase() === topic.toLowerCase())
    );
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
