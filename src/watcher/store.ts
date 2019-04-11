import { IAppointment } from "../dataEntities";
import logger from "../logger";

/**
 * The functionality required in an appointment store
 */
export interface IAppointmentStore {
    addOrUpdateByStateLocator(appointment: IAppointment): Promise<boolean>;
    removeById(appointmentId: string): Promise<boolean>;
    getExpiredSince(time: number): Promise<IAppointment[]>;
}

/**
 * Stores all appointments in memory. Has very inefficient processes for determining expired appointments so cannot be
 * used for high numbers of appointments.
 */
export class MemoryAppointmentStore implements IAppointmentStore {
    private readonly appointmentsById: {
        [appointmentId: string]: IAppointment;
    } = {};
    private readonly appointmentsByStateLocator: {
        [appointmentStateLocator: string]: IAppointment;
    } = {};

    async addOrUpdateByStateLocator(appointment: IAppointment): Promise<boolean> {
        const currentAppointment = this.appointmentsByStateLocator[appointment.getStateLocator()];
        // is there a current appointment
        if (currentAppointment) {
            if (currentAppointment.getStateNonce() >= appointment.getStateNonce()) {
                // the new appointment has a lower nonce than the one we're currently storing, so don't add it
                logger.info(
                    appointment.formatLog(
                        `Nonce ${appointment.getStateNonce()} is lower than current appointment ${
                            appointment.id
                        } nonce ${appointment.getStateNonce()}`
                    )
                );

                return false;
            } else {
                // remove the old appointment
                delete this.appointmentsById[currentAppointment.id];
            }
        }
        
        // add the new appointment
        this.appointmentsByStateLocator[appointment.getStateLocator()] = appointment;
        this.appointmentsById[appointment.id] = appointment;
        return true;
    }

    async removeById(appointmentId: string): Promise<boolean> {
        const appointmentById = this.appointmentsById[appointmentId];
        if (appointmentById) {
            // remove the appointment from the id index
            delete this.appointmentsById[appointmentId];

            // remove the appointment from the state locator index
            const currentAppointment = this.appointmentsByStateLocator[appointmentById.getStateLocator()];
            // if it has the same id
            if (currentAppointment.id === appointmentId) {
                delete this.appointmentsByStateLocator[appointmentById.getStateLocator()];
            }
            return true;
        }
        return false;
    }

    async getExpiredSince(expiryTime: number): Promise<IAppointment[]> {
        // 102: very inefficient sort, only useful for small appoinment numbers

        return Object.keys(this.appointmentsById)
            .map(a => this.appointmentsById[a])
            .filter(a => a.endTime < expiryTime);
    }
}
