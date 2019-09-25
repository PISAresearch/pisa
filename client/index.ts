import crossFetch from "cross-fetch";
import { defaultAbiCoder, keccak256, verifyMessage, arrayify } from "ethers/utils";

class AppointmentRequest {
    readonly customerAddress: string;
    readonly id: string;
    readonly nonce: number;
    readonly startBlock: number;
    readonly endBlock: number;
    readonly paymentHash: string;

    readonly eventAddress: string;
    readonly topics: (string | null)[];

    readonly contractAddress: string;
    readonly data: string;
    readonly gasLimit: number;
    readonly challengePeriod: number;
    readonly refund: string;
    readonly preCondition: string;
    readonly postCondition: string;
    readonly mode: number;
}

interface SignedApppointmentRequest extends AppointmentRequest {
    customerSig: string;
}

interface AppointmentReceipt {
    readonly appointment: SignedApppointmentRequest;
    readonly watcherSignature: string;
    readonly watcherAddress: string;
}

export default class PisaClient {
    private static APPOINTMENT_ENDPOINT = "appointment";
    private static APPOINTMENT_CUSTOMER_GET_ENDPOINT = "appointment/customer";

    /**
     *
     * @param pisaUrl The PISA server url
     * @param pisaContractAddress The address of the on-chain PISA contract
     */
    public constructor(public readonly pisaUrl: string, public readonly pisaContractAddress: string) {}


    // Encode the topics in the format expected from Pisa's contract.
    // See the implementation in utils/ethers.ts in the main folder of Pisa for more details.
    private static encodeTopicsForPisa(topics: (string | null)[]) {
        if (topics.length > 4) throw new Error(`There can be at most 4 topics. ${topics.length} were given.`)

        const topicsBitmap = [0, 1, 2, 3].map(idx => topics.length > idx && topics[idx] != null);
        const topicsFull = [0, 1, 2, 3].map(idx => topics.length > idx && topics[idx] != null ? topics[idx] : "0x0000000000000000000000000000000000000000000000000000000000000000");
        return defaultAbiCoder.encode(["bool[4]", "bytes32[4]"], [topicsBitmap, topicsFull]);
    }

    /**
     * Encode the request in the correct format for signature
     * @param request
     */
    private encodeAndHash(request: AppointmentRequest): string {
        const tupleDefinition = "tuple(address,address,uint,uint,uint,bytes32,uint,bytes,uint,uint,uint,address,bytes,bytes,bytes,bytes32)";

        const encoded = defaultAbiCoder.encode(
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
                    PisaClient.encodeTopicsForPisa(request.topics),
                    request.preCondition,
                    request.postCondition,
                    request.paymentHash
                ],
                this.pisaContractAddress
            ]
        );

        return keccak256(encoded);
    }

    /**
     * Check the response is 200, else throw an error with the contained messgae
     * @param response
     */
    private async checkResponse(response: Response) {
        if (!response.ok) {
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.indexOf("application/json") !== -1) {
                throw new Error((await response.json()).message);
            } else {
                throw new Error(await response.text());
            }
        }
        return response;
    }

    /**
     * Check that the returned receipt was correctly signed
     * @param receipt
     */
    private async validateReceipt(receipt: AppointmentReceipt): Promise<AppointmentReceipt> {
        const hash = this.encodeAndHash(receipt.appointment);
        const recoveredAddress = verifyMessage(arrayify(hash), receipt.watcherSignature);
        if (recoveredAddress.toLowerCase() === receipt.watcherAddress.toLowerCase()) return receipt;
        else throw new Error("Invalid receipt. Watcher signature invalid.");
    }

    /**
     * Generates a request object that can be used to request an **relay** appointment from
     * a pisa tower.
     * @param signer A signing function to create a signature.
     *   Receives a correctly formatted digest of the appointment, must return a signature
     *   created by the priv key associated with the customerAddress
     * @param customerAddress
     * @param id
     * @param nonce
     * @param startBlock
     * @param endBlock
     * @param contractAddress
     * @param data
     * @param gasLimit
     * @param challengePeriod
     */
    generateRequest(
        signer: (digest: string) => Promise<string>,
        customerAddress: string,
        id: string,
        nonce: number,
        startBlock: number,
        endBlock: number,
        contractAddress: string,
        data: string,
        gasLimit: number,
        challengePeriod: number
    ): Promise<SignedApppointmentRequest>;
    /**
     * Generates a request object that can be used to request an appointment from
     * a pisa tower.
     * @param signer A signing function to create a signature.
     *   Receives a correctly formatted digest of the appointment, must return a signature
     *   created by the priv key associated with the customerAddress
     * @param customerAddress
     * @param id
     * @param nonce
     * @param startBlock
     * @param endBlock
     * @param contractAddress
     * @param data
     * @param gasLimit
     * @param challengePeriod
     * @param eventAddress
     * @param topics
     */
    generateRequest(
        signer: (digest: string) => Promise<string>,
        customerAddress: string,
        id: string,
        nonce: number,
        startBlock: number,
        endBlock: number,
        contractAddress: string,
        data: string,
        gasLimit: number,
        challengePeriod: number,
        eventAddress: string,
        topics: (string | null)[]
    ): Promise<SignedApppointmentRequest>;
    public async generateRequest(
        signer: (digest: string) => Promise<string>,
        customerAddress: string,
        id: string,
        nonce: number,
        startBlock: number,
        endBlock: number,
        contractAddress: string,
        data: string,
        gasLimit: number,
        challengePeriod: number,
        eventAddress?: string,
        topics?: (string | null)[]
    ): Promise<SignedApppointmentRequest> {
        let mode;
        // all of these props must be populated, or none of them
        if (eventAddress && topics) mode = 1;
        // if none are populated we generate a relay transaction
        else if (!eventAddress && !topics) {
            eventAddress = "0x0000000000000000000000000000000000000000";
            topics = [];
            mode = 0;
        } else throw new Error('Either both or neither of "eventAddress" and "topics" must be populated.');

        const request: AppointmentRequest = {
            contractAddress: contractAddress,
            customerAddress: customerAddress,
            startBlock: startBlock,
            endBlock: endBlock,
            challengePeriod: challengePeriod,
            id: id,
            nonce: nonce,
            data: data,
            refund: "0",
            gasLimit: gasLimit,
            mode: mode,
            eventAddress: eventAddress,
            topics: topics,
            preCondition: "0x",
            postCondition: "0x",
            // pre-configured free hash
            paymentHash: "0xfc1624bdc50da30f2ea37b7debabeac1f6166db013c5880dcf63907b04199138"
        };

        const digest = this.encodeAndHash(request);
        const signature = await signer(digest);

        return {
            ...request,
            customerSig: signature
        };
    }

    /**
     * Makes a request to the remote PISA tower for the provided appointment.
     * @param request
     */
    public async executeRequest(request: SignedApppointmentRequest): Promise<AppointmentReceipt> {
        const response = await crossFetch(this.pisaUrl + "/" + PisaClient.APPOINTMENT_ENDPOINT, {
            method: "POST",
            body: JSON.stringify(request),
            headers: { "Content-Type": "application/json" }
        });

        return await this.checkResponse(response)
            .then(res => res.json())
            .then(rec => this.validateReceipt(rec as AppointmentReceipt));
    }

    /**
     * Generates a request object that can be used to request an **relay** appointment from
     * a pisa tower. Also sends the request to the PISA tower to receive an appointment receipt.
     * @param signer A signing function to create a signature.
     *   Receives a correctly formatted digest of the appointment, must return a signature
     *   created by the priv key associated with the customerAddress
     * @param customerAddress
     * @param id
     * @param nonce
     * @param startBlock
     * @param endBlock
     * @param contractAddress
     * @param data
     * @param gasLimit
     * @param challengePeriod
     */
    generateAndExecuteRequest(
        signer: (digest: string) => Promise<string>,
        customerAddress: string,
        id: string,
        nonce: number,
        startBlock: number,
        endBlock: number,
        contractAddress: string,
        data: string,
        gasLimit: number,
        challengePeriod: number
    ): Promise<AppointmentReceipt>;
    /**
     * Generates a request object that can be used to request an appointment from
     * a pisa tower. Also sends the request to the PISA tower to receive an appointment receipt.
     * @param signer A signing function to create a signature.
     *   Receives a correctly formatted digest of the appointment, must return a signature
     *   created by the priv key associated with the customerAddress
     * @param customerAddress
     * @param id
     * @param nonce
     * @param startBlock
     * @param endBlock
     * @param contractAddress
     * @param data
     * @param gasLimit
     * @param challengePeriod
     * @param eventAddress
     * @param topics
     */
    generateAndExecuteRequest(
        signer: (digest: string) => Promise<string>,
        customerAddress: string,
        id: string,
        nonce: number,
        startBlock: number,
        endBlock: number,
        contractAddress: string,
        data: string,
        gasLimit: number,
        challengePeriod: number,
        eventAddress: string,
        topics: (string | null)[]
    ): Promise<AppointmentReceipt>;
    public async generateAndExecuteRequest(
        signer: (digest: string) => Promise<string>,
        customerAddress: string,
        id: string,
        nonce: number,
        startBlock: number,
        endBlock: number,
        contractAddress: string,
        data: string,
        gasLimit: number,
        challengePeriod: number,
        eventAddress?: string,
        topics?: (string | null)[]
    ): Promise<AppointmentReceipt> {
        const request = await this.generateRequest(
            signer,
            customerAddress,
            id,
            nonce,
            startBlock,
            endBlock,
            contractAddress,
            data,
            gasLimit,
            challengePeriod,
            // we need to cast to string here to allow the compiler to accept possibly undefined values
            // this should only be the case if a caller has passed in undefined as one of the event args
            // in which case we can pass it to generateRequest in below where an error will be thrown.
            eventAddress as string,
            topics as (string | null)[]
        );
        return await this.executeRequest(request);
    }

    /**
     * Send a request to the Pisa tower to retrieve all the appointments for the given `customerAddress`.
     * @param customerAddress
     */
    public async getAppointmentsByCustomer(customerAddress: string) {
        return crossFetch(this.pisaUrl + "/" + PisaClient.APPOINTMENT_CUSTOMER_GET_ENDPOINT + "/" + customerAddress, {
            method: "GET",
            headers: { "Content-Type": "application/json" }
        }).then(res => res.json());
    }
}
export { PisaClient };
