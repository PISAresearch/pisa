import * as request from "request-promise";

export class PisaClient {
    constructor(private readonly hostAndPort: string) {}

    requestAppointment(appointmentRequest: any): request.RequestPromise {
        return request.post(`http://${this.hostAndPort}/appointment`, { json: appointmentRequest }, err => {
            if (err) {
                console.log(err);
            }
        });
    }
}