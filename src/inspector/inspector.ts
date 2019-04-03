import { Appointment, ChannelType } from "../dataEntities";
import { ConfigurationError } from "../dataEntities/errors";
import logger from "../logger";

export abstract class Inspector {
    protected constructor(public readonly channelType: ChannelType) {}
    
    public abstract async checkInspection(appointment): Promise<void>;

    /**
     * Inspects an appointment to decide whether to accept it. Throws on reject.
     * Sets an the result of the inspection on the appointment
     * @param appointment
     */
    async inspectAndPass(appointment: Appointment): Promise<void> {
        logger.info(appointment.formatLogEvent("Begin inspection."));
        logger.debug(appointment.formatLogEvent(JSON.stringify(appointment)));
        await this.checkInspection(appointment);
        // if we pass the inspection then set the result
        appointment.setInspectionResult(true, Date.now());
        logger.info(
            appointment.formatLogEvent(
                `Passed inspection. Start time: ${appointment.startTime}. End time: ${appointment.endTime}.`
            )
        );
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

    async checkInspection(appointment: Appointment) {
        const inspector = this.inspectorLookup[appointment.type];
        if (!inspector) throw new ConfigurationError(`Unregistered inspector type ${appointment.type}.`);

        await inspector.checkInspection(appointment);
    }
}
