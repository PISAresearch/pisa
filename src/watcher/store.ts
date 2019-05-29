import { IEthereumAppointment, StartStopService, IAppointment, ChannelType, ConfigurationError } from "../dataEntities";
import { LevelUp } from "levelup";
import encodingDown from "encoding-down";
import { LockManager } from "../utils/lock";

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
    getExpiredSince(block: number): IEthereumAppointment[];
}

/**
 * Stores all appointments in memory and in the db. Has an inefficient processes for
 * determining expired appointments so this function should not be used in a loop.
 */
export class AppointmentStore extends StartStopService implements IAppointmentStore {
    constructor(
        private readonly db: LevelUp<encodingDown<string, any>>,
        private readonly appointmentConstructors: Map<ChannelType, (obj: any) => IEthereumAppointment>
    ) {
        super("Appointment store");
    }

    protected async startInternal() {
        // access the db and load all state
        for await (const record of this.db.createValueStream()) {
            // the typing here insist this is a string
            const type = ((record as any) as IAppointment).type;
            const constrctr = this.appointmentConstructors.get(type);
            if (!constrctr) throw new ConfigurationError(`Unrecognised channel type: ${type}.`);

            const appointment = constrctr(record);
            // // add too the indexes
            this.appointmentsById[appointment.id] = appointment;
            this.appointmentsByStateLocator[appointment.getStateLocator()] = appointment;
        }
    }

    protected async stopInternal() {
        // do nothing
    }

    private readonly appointmentsById: {
        [appointmentId: string]: IEthereumAppointment;
    } = {};
    private readonly appointmentsByStateLocator: {
        [appointmentStateLocator: string]: IEthereumAppointment;
    } = {};

    // Every time we access the state locator, we need to make sure that this happens atomically.
    // This is not necessary for appointmentId, as they are unique for each appointment and generated internally.
    // Instead, multiple appointments can share the same state locator.
    private stateLocatorLockManager = new LockManager();

    /**
     * Checks to see if an appointment with the current state update exists. If it does
     * exist the current appointment is updated iff it has a lower nonce than the supplied
     * appointment. If it does not exist a new appointment is added in the store.
     * Returns true if the supplied item was added or updated in the store.
     * @param appointment
     */
    public addOrUpdateByStateLocator(appointment: IEthereumAppointment): Promise<boolean> {
        // As we are accessing data structures by state locator, we make sure to acquire a lock on it
        return this.stateLocatorLockManager.withLock(appointment.getStateLocator(), async () => {
            const currentAppointment = this.appointmentsByStateLocator[appointment.getStateLocator()];
            // is there a current appointment
            if (currentAppointment) {
                if (currentAppointment.getStateNonce() >= appointment.getStateNonce()) {
                    this.logger.info(
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

            // update the db
            const batch = this.db.batch().put(appointment.id, appointment.getDBRepresentation());
            if (currentAppointment) await batch.del(currentAppointment.id).write();
            else await batch.write();

            // add the new appointment
            this.appointmentsByStateLocator[appointment.getStateLocator()] = appointment;
            this.appointmentsById[appointment.id] = appointment;
            return true;
        });
    }

    /**
     * Remove an appointment if one exists for this id. Does nothing if an appointment does not
     * exist. Returns true if an item existed and was deleted.
     * @param appointmentId
     */
    public async removeById(appointmentId: string): Promise<boolean> {
        const appointment = this.appointmentsById[appointmentId];
        if (appointment) {
            const stateLocator = appointment.getStateLocator();
            // remove the appointment from the id index
            delete this.appointmentsById[appointmentId];

            // All updates related to resources related to stateLocator should happen atomically.
            // While the current code is blocking, we acquire a lock until we are done for clarity.
            await this.stateLocatorLockManager.withLock(stateLocator, async () => {
                // remove the appointment from the state locator index
                const currentAppointment = this.appointmentsByStateLocator[stateLocator];
                // if it has the same id
                if (currentAppointment.id === appointmentId) {
                    delete this.appointmentsByStateLocator[stateLocator];
                }
            });

            // and remove from remote storage
            await this.db.del(appointmentId);
            return true;
        }
        return false;
    }

    /**
     * Find all appointments that have an end block less than the supplied block.
     *
     * Measured this with a simple test and found that it takes ~50ms to filter through
     * 1 million objects so since we only do this once per block that should be ok for now.
     *
     * A more performant way would be to index these appointments by end block, then fetch each of the
     * blocks since we last expired by iterating through the block numbers since this function was
     * last called and returning the aggregate. Since the index should be backed by a sparse array this would
     * remain effecient as blocks are removed.
     * @param expiryBlock
     */
    public getExpiredSince(expiryBlock: number): IEthereumAppointment[] {
        return Object.values(this.appointmentsById).filter(a => a.endBlock < expiryBlock);
    }

    /**
     * Get all the appointments in the store
     */
    public getAll(): IEthereumAppointment[] {
        // all appointments must have expired by the time block number reaches max int
        return this.getExpiredSince(Number.MAX_SAFE_INTEGER);
    }
}
