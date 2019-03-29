import { IAppointmentRequest, ChannelType } from "../dataEntities";
import { ConfigurationError } from "../dataEntities/errors";

export interface IInspector {
    readonly channelType: ChannelType;
    inspect(appointmentRequest: IAppointmentRequest): Promise<void>;
}

/**
 * Triages requests to configured inspectors
 */
export class MultiInspector implements IInspector {
    constructor(inspectors: IInspector[]) {
        inspectors.forEach(i => (this.inspectorLookup[i.channelType] = i));
    }
    public readonly channelType = ChannelType.None;
    private readonly inspectorLookup: {
        [type: number]: IInspector;
    } = {};

    async inspect(appointmentRequest: IAppointmentRequest) {
        const inspector = this.inspectorLookup[appointmentRequest.type];
        if (!inspector) throw new ConfigurationError(`Unregistered inspector type ${appointmentRequest.type}.`);

        await inspector.inspect(appointmentRequest);
    }
}


