export interface IKitsuneStateUpdate {
    signatures: string[];
    hashState: string;
    round: number;
    contractAddress: string;
}

export interface IRaidenStateUpdate {
    channel_identifier: number;
    closing_participant: string;
    non_closing_participant: string;
    balance_hash: string;
    nonce: number;
    additional_hash: string;
    closing_signature: string;
    non_closing_signature: string;
    chain_id: number;
    token_network_identifier: string;
}
