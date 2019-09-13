import crossFetch from "cross-fetch";
import { defaultAbiCoder, keccak256, verifyMessage, arrayify } from "ethers/utils";

class AppointmentRequest {
    readonly contractAddress: string;
    readonly customerAddress: string;
    readonly startBlock: number;
    readonly endBlock: number;
    readonly challengePeriod: number;
    readonly nonce: number;
    readonly data: string;
    readonly refund: string;
    readonly gasLimit: number;
    readonly eventAddress: string;
    readonly eventABI: string;
    readonly eventArgs: string;
    readonly preCondition: string;
    readonly postCondition: string;
    readonly paymentHash: string;
    readonly id: string;
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

    /**
     *
     * @param pisaUrl The PISA server url
     * @param pisaContractAddress The address of the on-chain contract
     */
    constructor(public readonly pisaUrl: string, public readonly pisaContractAddress: string) {}

    /**
     * Encode the request in the correct format for signature
     * @param request
     */
    private encodeAndHash(request: AppointmentRequest): string {
        const tupleDefinition =
            "tuple(address,address,uint,uint,uint,bytes32,uint,bytes,uint,uint,uint,address,string,bytes,bytes,bytes,bytes32)";

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
                    request.eventABI,
                    request.eventArgs,
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
     * See http://alpha.pisa.watch:5487/docs.html for parameter details.
     * @param signer A signing function to create a signature.
     *   Receives a correctly formatted digest of the appointment, must return a signature
     *   created by the priv key associated with the customerAddress
     * @param contractAddress
     * @param customerAddress
     * @param startBlock
     * @param endBlock
     * @param challengePeriod
     * @param id
     * @param nonce
     * @param data
     * @param gasLimit
     */
    generateRequest(
        signer: (digest: string) => Promise<string>,
        contractAddress: string,
        customerAddress: string,
        startBlock: number,
        endBlock: number,
        challengePeriod: number,
        id: string,
        nonce: number,
        data: string,
        gasLimit: number
    ): Promise<SignedApppointmentRequest>;
    /**
     * Generates a request object that can be used to request an appointment from
     * a pisa tower.
     * See http://alpha.pisa.watch:5487/docs.html for parameter details.
     * @param signer A signing function to create a signature.
     *   Receives a correctly formatted digest of the appointment, must return a signature
     *   created by the priv key associated with the customerAddress
     * @param contractAddress
     * @param customerAddress
     * @param startBlock
     * @param endBlock
     * @param challengePeriod
     * @param id
     * @param nonce
     * @param data
     * @param gasLimit
     * @param eventAddress
     * @param eventABI
     * @param eventArgs
     */
    generateRequest(
        signer: (digest: string) => Promise<string>,
        contractAddress: string,
        customerAddress: string,
        startBlock: number,
        endBlock: number,
        challengePeriod: number,
        id: string,
        nonce: number,
        data: string,
        gasLimit: number,
        eventAddress: string,
        eventABI: string,
        eventArgs: string
    ): Promise<SignedApppointmentRequest>;
    public async generateRequest(
        signer: (digest: string) => Promise<string>,
        contractAddress: string,
        customerAddress: string,
        startBlock: number,
        endBlock: number,
        challengePeriod: number,
        id: string,
        nonce: number,
        data: string,
        gasLimit: number,
        eventAddress?: string,
        eventABI?: string,
        eventArgs?: string
    ): Promise<SignedApppointmentRequest> {
        let mode;
        // all of these props must be populated, or none of them
        if (eventAddress && eventABI && eventArgs) mode = 1;
        // if none are populated we generate a relay transaction
        else if (!eventAddress && !eventABI && !eventArgs) {
            eventAddress = "0x0000000000000000000000000000000000000000";
            eventABI = "";
            eventArgs = "0x";
            mode = 0;
        } else throw new Error('Either all or none of "eventAddress","eventABI" and "eventArgs" must be populated.');

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
            eventABI: eventABI,
            eventArgs: eventArgs,
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
     * See http://alpha.pisa.watch:5487/docs.html for parameter details.
     * @param signer A signing function to create a signature.
     *   Receives a correctly formatted digest of the appointment, must return a signature
     *   created by the priv key associated with the customerAddress
     * @param contractAddress
     * @param customerAddress
     * @param startBlock
     * @param endBlock
     * @param challengePeriod
     * @param id
     * @param nonce
     * @param data
     * @param gasLimit
     */
    generateAndExecuteRequest(
        signer: (digest: string) => Promise<string>,
        contractAddress: string,
        customerAddress: string,
        startBlock: number,
        endBlock: number,
        challengePeriod: number,
        id: string,
        nonce: number,
        data: string,
        gasLimit: number
    ): Promise<AppointmentReceipt>;
    /**
     * Generates a request object that can be used to request an appointment from
     * a pisa tower. Also sends the request to the PISA tower to receive an appointment receipt.
     * See http://alpha.pisa.watch:5487/docs.html for parameter details.
     * @param signer A signing function to create a signature.
     *   Receives a correctly formatted digest of the appointment, must return a signature
     *   created by the priv key associated with the customerAddress
     * @param contractAddress
     * @param customerAddress
     * @param startBlock
     * @param endBlock
     * @param challengePeriod
     * @param id
     * @param nonce
     * @param data
     * @param gasLimit
     * @param eventAddress
     * @param eventABI
     * @param eventArgs
     */
    generateAndExecuteRequest(
        signer: (digest: string) => Promise<string>,
        contractAddress: string,
        customerAddress: string,
        startBlock: number,
        endBlock: number,
        challengePeriod: number,
        id: string,
        nonce: number,
        data: string,
        gasLimit: number,
        eventAddress: string,
        eventABI: string,
        eventArgs: string
    ): Promise<AppointmentReceipt>;
    public async generateAndExecuteRequest(
        signer: (digest: string) => Promise<string>,
        contractAddress: string,
        customerAddress: string,
        startBlock: number,
        endBlock: number,
        challengePeriod: number,
        id: string,
        nonce: number,
        data: string,
        gasLimit: number,
        eventAddress?: string,
        eventABI?: string,
        eventArgs?: string
    ): Promise<AppointmentReceipt> {
        const request =
            eventAddress && eventABI && eventArgs
                ? await this.generateRequest(
                      signer,
                      contractAddress,
                      customerAddress,
                      startBlock,
                      endBlock,
                      challengePeriod,
                      id,
                      nonce,
                      data,
                      gasLimit,
                      eventAddress,
                      eventABI,
                      eventArgs
                  )
                : await this.generateRequest(
                      signer,
                      contractAddress,
                      customerAddress,
                      startBlock,
                      endBlock,
                      challengePeriod,
                      id,
                      nonce,
                      data,
                      gasLimit
                  );
        return await this.executeRequest(request);
    }
}
export { PisaClient };
