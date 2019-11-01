import "mocha";
import request from "request-promise";
import * as SosContract from "./SOSContract";
import { Wallet, ethers } from "ethers";
import { JsonRpcProvider } from "ethers/providers";
import { wait } from "../../packages/test-utils/src";
import { IAppointmentRequest } from "../../packages/main/src/dataEntities"
import { arrayify } from "ethers/utils";
import { encodeTopicsForPisa } from "../../packages/main/src/utils/ethers";

// Omit introduced in TypeScript 3.5
type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>

/**
 * Encode the request in the correct format for signature
 * @param request
 */
function encodeAndHash(request: Omit<IAppointmentRequest, "customerSig">, pisaContractAddress: string): string {
    const tupleDefinition = "tuple(address,address,uint,uint,uint,bytes32,uint,bytes,uint,uint,uint,address,bytes,bytes,bytes,bytes32)";

    const encoded = ethers.utils.defaultAbiCoder.encode(
        [tupleDefinition, "address"],
        [
            [
                request.contractAddress,
                request.customerAddress,
                request.startBlock,
                request.endBlock,
                request.challengePeriod,
                request.id,
                request.nonce,
                request.data,
                request.refund,
                request.gasLimit,
                request.mode,
                request.eventAddress,
                encodeTopicsForPisa(request.topics),
                request.preCondition,
                request.postCondition,
                request.paymentHash
            ],
            pisaContractAddress
        ]
    );

    return ethers.utils.keccak256(encoded);
}

describe("alpha", () => {
    const PISA_URL = "http://18.219.31.158:5487/appointment";
    const ROPSTEN_URL = "https://ropsten.infura.io/v3/e587e78efcdd4c1eb5b068ee99a6ec0b";
    const PISA_CONTRACT_ADDRESS = "0xA02C7260c0020343040A504Ef24252c120be60b9";

    const createAppointmentRequest = (
        contractAddress: string,
        customerAddress: string,
        data: string,
        topics: (string | null)[],
        id: string,
        nonce: number,
        startBlock: number
    ) => {
        return {
            challengePeriod: 100,
            contractAddress,
            customerAddress: customerAddress,
            data,
            endBlock: startBlock + 130,
            eventAddress: contractAddress,
            topics,
            gasLimit: 100000,
            id,
            nonce: nonce,
            mode: 1,
            preCondition: "0x",
            postCondition: "0x",
            refund: "0",
            startBlock,
            paymentHash: "0xfc1624bdc50da30f2ea37b7debabeac1f6166db013c5880dcf63907b04199138"
        };
    };

    it("pisa", async () => {
        // connect to ropsten
        const provider = new JsonRpcProvider(ROPSTEN_URL);

        // 0xC73e1ebaFE312F149272ccA46A4acA3F8e8C62A6
        const customer = new Wallet("0xD3E0200D9A8E615ED48E8317730EDD239BCDE54FB6EB2EBDC2FD6E6EA57AD6B3", provider);

        // deploy the contract
        const channelContractFactory = new ethers.ContractFactory(SosContract.ABI, SosContract.ByteCode, customer);
        const rescueContract = channelContractFactory.attach("0x75D7a9470a69dd41E5d18F6503CBcF0dD1f788a8");
        // const rescueContract = await channelContractFactory.deploy();

        // setup
        const startBlock = await provider.getBlockNumber();
        const helpMessage = "sos";
        const id = "0x0000000000000000000000000000000000000000000000000000000000000004";
        const nonce = 1;

        const iFace = new ethers.utils.Interface(SosContract.ABI);
        const topics = iFace.events["Distress"].encodeTopics([helpMessage]);
        // create an appointment
        const appointmentRequest = createAppointmentRequest(
            rescueContract.address,
            customer.address,
            SosContract.encodeData("remote"),
            topics,
            id,
            nonce,
            startBlock
        );

        // encode the request and sign it
        const hashedWithAddress = encodeAndHash(appointmentRequest, PISA_CONTRACT_ADDRESS);
        const customerSig = await customer.signMessage(arrayify(hashedWithAddress));

        const response = await request.post(PISA_URL, {
            json: { ...appointmentRequest, customerSig }
        });
        console.log(response);

        let success = false;
        rescueContract.once(SosContract.RESCUE_EVENT_METHOD_SIGNATURE, () => (success = true));
        await wait(50);

        const tx = await rescueContract.help(helpMessage, { gasLimit: 1000000 });
        console.log("help broadcast");
        await tx.wait();
        console.log("help mined");

        await waitForPredicate(() => success, 500, 1000, helpMessage + ":Failed");
    }).timeout(200000);
});

const waitForPredicate = (
    predicate: () => Promise<boolean> | boolean,
    interval: number,
    repetitions: number,
    message: string | (() => Promise<string>)
) => {
    return new Promise((resolve, reject) => {
        const intervalHandle = setInterval(async () => {
            const predResult = await predicate();
            if (predResult) {
                resolve();
                clearInterval(intervalHandle);
            } else if (--repetitions <= 0) {
                if (message.length) reject(new Error(message as string));
                else reject(new Error(await (message as () => Promise<string>)()));
            }
        }, interval);
    });
};
