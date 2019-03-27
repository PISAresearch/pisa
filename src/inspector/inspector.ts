import { IAppointmentRequest, IAppointment, ChannelType } from "../dataEntities/appointment";

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
    readonly channelType: ChannelType;
    // PISA:  this should return a bool
    inspect(appointmentRequest: IAppointmentRequest): IAppointment | Promise<IAppointment>;
}

export class MultiInspector implements IInspector {
    constructor(inspectors: IInspector[]) {
        inspectors.forEach(i => (this.inspectorLookup[i.channelType] = i));
    }
    public readonly channelType = ChannelType.None;
    private readonly inspectorLookup: {
        [type: number]: IInspector;
    } = {};

    inspect(appointmentRequest: IAppointmentRequest) {
        const inspector = this.inspectorLookup[appointmentRequest.type];
        if (!inspector) {
            throw new ConfigurationError(`Unregistered inspector type ${appointmentRequest.type}.`);
        }
        return inspector.inspect(appointmentRequest);
    }
}

// PISA: error handling for this + docs
class ConfigurationError extends Error {}
