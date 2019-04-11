import { IAppointment } from "../dataEntities"

export class WatchedAppointmentStore {
    private readonly appointmentsById: {
        [appointmentId: string]: IAppointment;
    } = {};
    private readonly appointmentsByStateLocator: {
        [appointmentStateLocator: string]: IAppointment;
    } = {};

    async addOrUpdate(appointment: IAppointment): Promise<void> {
        const currentAppointment = this.appointmentsByStateLocator[appointment.getStateLocator()];
        if (currentAppointment) {
            if (currentAppointment.getStateNonce() >= appointment.getStateNonce()) {
                // PISA: if we've been given a nonce lower than the one we have already we should silently swallow it, not throw an error
                // PISA: this is because we shouldn't be giving out information about what appointments are already in place
                // PISA: we throw an error for now, with low information, but this should be removed.
                throw new Error("haha");
            } else {
                // the appointment exists, and we're replacing it, so remove from our id index
                this.appointmentsById[currentAppointment.id] = undefined;
            }
        }
        this.appointmentsByStateLocator[appointment.getStateLocator()] = appointment;
        this.appointmentsById[appointment.id] = appointment;
    }

    async remove(appointmentId: string): Promise<void> {
        const appointmentById = this.appointmentsById[appointmentId];
        // remove the appointment from the id index
        this.appointmentsById[appointmentId] = undefined;

        // remove the appointment from the state locator index
        const currentAppointment = this.appointmentsByStateLocator[appointmentById.getStateLocator()];
        // if it has the same id
        if (currentAppointment.id === appointmentId)
            this.appointmentsByStateLocator[appointmentById.getStateLocator()] = undefined;
    }

    async getExpiredBefore(blockNumber: number): Promise<IAppointment[]> {
        // 102: very inefficient sort, only useful for small appoinment numbers
        return Object.keys(this.appointmentsById)
            .map(a => this.appointmentsById[a])
            .filter(a => a.endTime < blockNumber);
    }
}
