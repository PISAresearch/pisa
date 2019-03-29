import { IAppointment, ChannelType } from "../dataEntities";
import { ConfigurationError } from "../dataEntities/errors";
import logger from "../logger";

export abstract class Inspector {
    constructor(public readonly channelType: ChannelType) {}

    /**
     * Inspects an appointment to decide whether to accept it. Throws on reject.
     * @param appointment
     */
    public abstract checkInspection(appointment: IAppointment): Promise<void>;

    /**
     * Inspects an appointment to decide whether to accept it. Throws on reject.
     * Sets an the result of the inspection on the appointment
     * @param appointment
     */
    public async inspectAndPass(appointment: IAppointment) {
        logger.info(appointment.formatLogEvent("Begin inspection."));
        logger.debug(appointment.formatLogEvent(JSON.stringify(appointment)));
        await this.checkInspection(appointment);
        logger.info(appointment.formatLogEvent(`Passed inspection. Start time: ${appointment.startTime}. End time: ${appointment.endTime}.`))
        
        // if we pass the inspection then set the result
        appointment.setInspectionResult(true, Date.now());
    }
}

/**
 * Triages requests to configured inspectors
 */
export class MultiInspector extends Inspector {
    constructor(inspectors: Inspector[]) {
        super(ChannelType.None);
        inspectors.forEach(i => (this.inspectorLookup[i.channelType] = i));
    }
    private readonly inspectorLookup: {
        [type: number]: Inspector;
    } = {};

    async checkInspection(appointment: IAppointment) {
        const inspector = this.inspectorLookup[appointment.type];
        if (!inspector) throw new ConfigurationError(`Unregistered inspector type ${appointment.type}.`);

        await inspector.checkInspection(appointment);
    }
}
