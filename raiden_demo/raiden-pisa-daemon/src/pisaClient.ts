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

    async requestAppointment(appointmentRequest: IAppointmentRequest) {
        await request.post(`http://${this.hostAndPort}/appointment`, { json: appointmentRequest });
    }

    async requestRaidenAppointment(appointmentRequest: IAppointmentRequest) {
        await request.post(`http://${this.hostAndPort}/raidenAppointment`, { json: appointmentRequest });
    }
}

export interface IAppointmentRequest {
    expiryPeriod: number;
    stateUpdate: IDoubleSignedBalanceProof
}