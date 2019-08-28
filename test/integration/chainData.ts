import { Key } from "./keyStore";

export class ChainData {
    constructor(
        public readonly name: string,
        public readonly validators: Key[],
        public readonly stepDuration: number,
        public readonly account: Key
    ) {}

    serialise() {
        return {
            name: this.name,
            engine: {
                authorityRound: {
                    params: {
                        stepDuration: this.stepDuration,
                        validators: {
                            list: this.validators.map(v => v.account)
                        }
                    }
                }
            },
            params: {
                gasLimitBoundDivisor: "0x400",
                maximumExtraDataSize: "0x20",
                minGasLimit: "0x1388",
                networkID: "0x2323",
                eip155Transition: 0,
                validateChainIdTransition: 0,
                eip140Transition: 0,
                eip211Transition: 0,
                eip214Transition: 0,
                eip658Transition: 0
            },
            genesis: {
                seal: {
                    authorityRound: {
                        step: "0x0",
                        signature:
                            "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
                    }
                },
                difficulty: "0x20000",
                gasLimit: "0x7A1200"
            },
            accounts: {
                "0x0000000000000000000000000000000000000001": {
                    balance: "1",
                    builtin: { name: "ecrecover", pricing: { linear: { base: 3000, word: 0 } } }
                },
                "0x0000000000000000000000000000000000000002": {
                    balance: "1",
                    builtin: { name: "sha256", pricing: { linear: { base: 60, word: 12 } } }
                },
                "0x0000000000000000000000000000000000000003": {
                    balance: "1",
                    builtin: { name: "ripemd160", pricing: { linear: { base: 600, word: 120 } } }
                },
                "0x0000000000000000000000000000000000000004": {
                    balance: "1",
                    builtin: { name: "identity", pricing: { linear: { base: 15, word: 3 } } }
                },
                [this.account.account]: { balance: "10000000000000000000000" }
            }
        };
    }
}
