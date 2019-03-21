// DO NOT EDIT
// Cloned from raiden_demo/raiden-pisa-daemon/src/balanceProof.ts.
// TODO: refactor the shared code


import { ethers } from "ethers";

export interface IRawBalanceProof {
    nonce: number;
    transferred_amount: string;
    locked_amount: string;
    locksroot: string;
    token_network_identifier: string;
    channel_identifier: number;
    message_hash: string;
    signature: string;
    sender: string;
    chain_id: number;
    balance_hash: string;
    _type: string;
    _version: number;
}

export class BalanceProofSigGroup {
    /// ///
    // from the contract
    /// ///

    // enum MessageTypeId {
    //     None,
    //     BalanceProof,
    //     BalanceProofUpdate,
    //     Withdraw,
    //     CooperativeSettle
    // }

    // bytes32 message_hash = keccak256(abi.encodePacked(
    //     signature_prefix,
    //     message_length,
    //     address(this),
    //     chain_id,
    //     uint256(MessageTypeId.BalanceProofUpdate),
    //     channel_identifier,
    //     balance_hash,
    //     nonce,
    //     additional_hash,
    //     closing_signature
    // ));

    constructor(
        public readonly token_network_identifier: string,
        public readonly chain_id: number,
        public readonly channel_identifier: number,
        public readonly balance_hash: string,
        public readonly nonce: number,
        public readonly additional_hash: string,
        public readonly closing_signature: string
    ) {}

    public static fromBalanceProof(bp: IRawBalanceProof) {
        // take the parts that need signing from balance proof to form a new object
        return new BalanceProofSigGroup(
            bp.token_network_identifier,
            bp.chain_id,
            bp.channel_identifier,
            bp.balance_hash,
            bp.nonce,
            bp.message_hash,
            bp.signature
        );
    }

    public static ethereumSignedMessageString = "\x19Ethereum Signed Message\n";
    // // Length of the actual message: 20 + 32 + 32 + 32 + 32 + 32 + 32 + 65
    // string memory message_length = '277';

    public packForCloser(): string {
        return ethers.utils.solidityPack(
            ["address", "uint256", "uint256", "uint256", "bytes32", "uint256", "bytes32"],
            [
                this.token_network_identifier,
                this.chain_id,
                1,
                this.channel_identifier,
                this.balance_hash,
                this.nonce,
                this.additional_hash
            ]
        );
    }

    public packForNonCloser(): string {
        return ethers.utils.solidityPack(
            ["address", "uint256", "uint256", "uint256", "bytes32", "uint256", "bytes32", "bytes"],
            [
                this.token_network_identifier,
                this.chain_id,
                2,
                this.channel_identifier,
                this.balance_hash,
                this.nonce,
                this.additional_hash,
                this.closing_signature
            ]
        );
    }

    public async sign(hash: string, wallet: ethers.Wallet) {
        return await wallet.signMessage(ethers.utils.arrayify(hash));
    }
}