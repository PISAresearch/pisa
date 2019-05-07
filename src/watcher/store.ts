import { IEthereumAppointment } from "../dataEntities";
import logger from "../logger";
import { LevelUp } from "levelup";
import encodingDown from "encoding-down";
/**
 * The functionality required in an appointment store
 */
export interface IAppointmentStore {
    /**
     * Add an appointment to the store. If an appointment with the same state
     * locator already exists, it is updated if the supplied appointment has a higher nonce,
     * otherwise this does nothing. If an appointment with the same state locator does not
     * already exist, then appointment is added.
     * @param appointment
     */
    addOrUpdateByStateLocator(appointment: IEthereumAppointment): Promise<boolean>;

    /**
     * Remove an appointment which matches this id. Do nothing if that appointment does not exist.
     * @param appointmentId
     */
    removeById(appointmentId: string): Promise<boolean>;

    /**
     * Find all appointments that have expired at a certain block.
     * @param block
     */
    getExpiredSince(block: number): Promise<IEthereumAppointment[]>;
}

/**
 * Stores all appointments in memory. Has very inefficient processes for determining expired appointments so cannot be
 * used for high numbers of appointments.
 */
export class AppointmentStore implements IAppointmentStore {
    public constructor(private readonly db: LevelUp<encodingDown<string, any>>) {}

    private readonly appointmentsById: {
        [appointmentId: string]: IEthereumAppointment;
    } = {};
    private readonly appointmentsByStateLocator: {
        [appointmentStateLocator: string]: IEthereumAppointment;
    } = {};

    protected async startInternal() {}

    protected async stopInternal() {}

    async addOrUpdateByStateLocator(appointment: IEthereumAppointment): Promise<boolean> {
        const currentAppointment = this.appointmentsByStateLocator[appointment.getStateLocator()];
        // is there a current appointment
        if (currentAppointment) {
            if (currentAppointment.getStateNonce() >= appointment.getStateNonce()) {
                logger.info(
                    appointment.formatLog(
                        `Nonce ${appointment.getStateNonce()} is lower than current appointment ${
                            currentAppointment.id
                        } nonce ${currentAppointment.getStateNonce()}`
                    )
                );

                return false;
            } else {
                // remove the old appointment
                delete this.appointmentsById[currentAppointment.id];
            }
        }

        // TODO:6:
        const batch = this.db.batch().put(appointment.id, appointment);
        if (currentAppointment) await batch.del(currentAppointment.id).write();
        else await batch.write();

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

    async getExpiredSince(expiryBlock: number): Promise<IEthereumAppointment[]> {
        return Object.values(this.appointmentsById).filter(a => a.endBlock < expiryBlock);
    }
}
