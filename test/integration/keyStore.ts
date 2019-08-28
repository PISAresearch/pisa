import { ethers } from "ethers";
import wordlistEn from "ethers/wordlists/lang-en";

export class Key {
    public wallet: ethers.Wallet;
    public encryptedJson: string;

    constructor(public readonly mnemonic: string, public readonly password: string, json: any) {
        this.wallet = ethers.Wallet.fromMnemonic(mnemonic);
        this.encryptedJson = JSON.stringify(json);
    }

    public get account() {
        return ("0x" + JSON.parse(this.encryptedJson).address) as string;
    }

    public static async generate(mnemonic: string, password: string) {
        const wallet = ethers.Wallet.fromMnemonic(mnemonic);
        const json = JSON.parse(await wallet.encrypt(password));
        return new Key(mnemonic, password, json);
    }
}

export class KeyStore {
    public account0: Key;
    public account1: Key;
    // public  account2: Key;
    // public  account3: Key;
    // public  account4: Key;
    // public  account5: Key;
    // public  account6: Key;
    // public  account7: Key;
    // public  account8: Key;
    // public  account9: Key;

    private mnemonic0 =
        "wood feed pottery latin toddler unveil ripple impulse question obvious guide sign canoe truck armed";
    private mnemonic1 = "ice post fury real thrive often inside cattle trigger hood first combine organ real jealous";
    private mnemonic2 =
        "concert vault novel ankle panic genius pet clutch barrel thunder tunnel garlic increase vital maid";
    private mnemonic3 =
        "produce grocery satisfy recipe message comfort push gate pull foam tide local kite cause vendor";
    private mnemonic4 = "glow silver hood half strong wait van sorry brain course tower aerobic aerobic vast tattoo";
    private mnemonic5 =
        "truth install memory wish industry border victory gather model abandon device one boss mountain increase";
    private mnemonic6 = "merit reunion current elite minor carpet fan lonely glue there property shoe rich loan cheap";
    private mnemonic7 = "alpha bonus laundry stay divorce loyal lawn anxiety tobacco relax rail fold rare hen profit";
    private mnemonic8 =
        "gauge sentence hen fee sunny camera rice notice monkey amount spot describe shell source copper";
    private mnemonic9 =
        "mountain tomato enact federal layer quarter female grocery lemon digital vote harsh general lumber circle";

    public static theKeyStore: KeyStore = new KeyStore();

    private constructor() {
        this.account0 = new Key(
            "wood feed pottery latin toddler unveil ripple impulse question obvious guide sign canoe truck armed",
            "account0",
            {
                address: "6f0b9328ef5eb5a5124b66568d699d04f196fb54",
                id: "e73b29a6-1f3c-44d9-9868-022f8583ea9e",
                version: 3,
                Crypto: {
                    cipher: "aes-128-ctr",
                    cipherparams: { iv: "76b843b2d54ca4629ae3798069c77080" },
                    ciphertext: "9de7b8df781c5de6c2e6ea32fb9ec973dfcfa4c9ab1aa1f3c77bbb45fb64879e",
                    kdf: "scrypt",
                    kdfparams: {
                        salt: "33489d8614a7b087136c846bfdf54195dabdf906f3fd358bc505ae0b1642d416",
                        n: 131072,
                        dklen: 32,
                        p: 1,
                        r: 8
                    },
                    mac: "2034b945b91d502e07b66dd89f0f11054916241c8cfb13ee1bb24770890c9bf6"
                }
            }
        );
        this.account1 = new Key(
            "ice post fury real thrive often inside cattle trigger hood first combine organ real jealous",
            "account1",
            {
                address: "55ea674f74ab2b939accf9324a380af14a6c12a0",
                id: "0758f4aa-08c9-4f69-82d7-896f9544b643",
                version: 3,
                Crypto: {
                    cipher: "aes-128-ctr",
                    cipherparams: { iv: "486b3764dc7b2848797a8533e9c7596d" },
                    ciphertext: "d500b7d31bf809c6002aa71bd37665f9f0dbea23fbd1a6d82855f485b71e3f78",
                    kdf: "scrypt",
                    kdfparams: {
                        salt: "f804485c0648ebee1b7946c624fa2972bb1875dd1931d2a3e1059168a1b9625d",
                        n: 131072,
                        dklen: 32,
                        p: 1,
                        r: 8
                    },
                    mac: "da134d318f912235a37b116ad2283af5f48500c49e0bdc77f7024341b590a1e4"
                }
            }
        );
    }
}
