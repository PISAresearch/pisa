import { ethers } from "ethers";
import { ArgumentError } from "@pisa-research/errors";
import { PlainObjectOrSerialisable, SerialisableBigNumber } from "@pisa-research/utils";

export type IBlockStub = {
    hash: string;
    number: number;
    parentHash: string;
}

export type Logs = PlainObjectOrSerialisable & {
    logs: (ethers.providers.Log & PlainObjectOrSerialisable)[];
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

export type TransactionStub = {
    blockNumber?: number;
    nonce: number;
    to?: string;
    from: string;
    chainId: number;
    data: string;
    value: SerialisableBigNumber;
    gasLimit: SerialisableBigNumber;
    gasPrice: SerialisableBigNumber;
    confirmations: number;
    hash: string;
} & PlainObjectOrSerialisable;

export type Transactions = IBlockStub & {
    transactions: TransactionStub[];
}

export type Block = IBlockStub & Logs & TransactionHashes & Transactions & PlainObjectOrSerialisable;

export type BlockAndAttached<TBlock extends IBlockStub> = {
    block: TBlock;
    attached: boolean;
};
