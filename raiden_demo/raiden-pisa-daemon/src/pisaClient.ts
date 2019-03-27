import * as request from "request-promise";

export interface IDoubleSignedBalanceProof {
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

export class PisaClient {
    constructor(private readonly hostAndPort: string) {}

    requestAppointment(appointmentRequest: IAppointmentRequest): request.RequestPromise {
        return request.post(
            `http://${this.hostAndPort}/appointment`,
            { json: appointmentRequest },
            (err) => {
                if (err) {
                    console.log(err);
                }
            }
        );
    }
}

export interface IAppointmentRequest {
    expiryPeriod: number;
    type: ChannelType.Raiden,
    stateUpdate: IDoubleSignedBalanceProof
}

export enum ChannelType {
    Kitsune = 1,
    Raiden = 2
}