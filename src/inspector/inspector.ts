import { IKitsuneAppointmentRequest, KitsuneAppointment } from "../dataEntities/appointment";

/**
 * Thrown when an appointment fails inspection
 * Error messages must be safe to expose publicly
 */
export class PublicInspectionError extends Error {
    constructor(message?: string) {
        super(message);
    }
}

export interface IInspector {
    // PISA:  this should return a bool
    inspect(appointmentRequest: IKitsuneAppointmentRequest): KitsuneAppointment | Promise<KitsuneAppointment>;
}

