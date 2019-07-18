import { StartStopService, IAppointment, ChannelType, ConfigurationError } from "../dataEntities";
import { LevelUp } from "levelup";
import encodingDown from "encoding-down";
import { LockManager } from "../utils/lock";
import { Appointment } from "../dataEntities/appointment";

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
    addOrUpdateByStateLocator(appointment: Appointment): Promise<boolean>;

    /**
     * Remove an appointment which matches this id. Do nothing if that appointment does not exist.
     * @param uniqueJobId
     */
    removeById(uniqueJobId: string): Promise<boolean>;

    /**
     * Find all appointments that have expired at a certain block.
     * @param block
     */
    getExpiredSince(block: number): Appointment[];
}

/**
 * Stores all appointments in memory and in the db. Has an inefficient processes for
 * determining expired appointments so this function should not be used in a loop.
 */
export class AppointmentStore extends StartStopService implements IAppointmentStore {
    constructor(
        private readonly db: LevelUp<encodingDown<string, any>>,
        //TODO:173: clean this up
    //    private readonly appointmentConstructors: Map<ChannelType, (obj: any) => IAppointment2>
    ) {
        super("appointment-store");
    }

    protected async startInternal() {
        // access the db and load all state
        for await (const record of this.db.createValueStream()) {
            // the typing here insist this is a string
            // TODO:173: clean up this types stuff
            //const type = ((record as any) as IAppointment2).type;
            //const constrctr = this.appointmentConstructors.get(type);
            //if (!constrctr) throw new ConfigurationError(`Unrecognised channel type: ${type}.`);

            //const appointment = constrctr(record);
            const appointment = Appointment.fromIAppointment((record as any) as IAppointment);
            // // add too the indexes
            this.appointmentsById[appointment.uniqueJobId()] = appointment;
            this.appointmentsByStateLocator[appointment.uniqueId()] = appointment;
        }
    }

    protected async stopInternal() {
        // do nothing
    }

    private readonly appointmentsById: {
        [appointmentId: string]: Appointment;
    } = {};
    private readonly appointmentsByStateLocator: {
        [appointmentStateLocator: string]: Appointment;
    } = {};

    // Every time we access the state locator, we need to make sure that this happens atomically.
    // This is not necessary for appointmentId, as they are unique for each appointment and generated internally.
    // Instead, multiple appointments can share the same state locator.
    private stateLocatorLockManager = new LockManager();

    // TODO:173: are these docs still correct?
    /**
     * Checks to see if an appointment with the current state update exists. If it does
     * exist the current appointment is updated iff it has a lower nonce than the supplied
     * appointment. If it does not exist a new appointment is added in the store.
     * Returns true if the supplied item was added or updated in the store.
     * @param appointment
     */
    public addOrUpdateByStateLocator(appointment: Appointment): Promise<boolean> {
        // TODO:173: here we dont update by state selector, we update by appointment id
        // TODO:173: and we dont check the nonce, we check the job id

        // As we are accessing data structures by state locator, we make sure to acquire a lock on it
        return this.stateLocatorLockManager.withLock(appointment.uniqueId(), async () => {
            
            const currentAppointment = this.appointmentsByStateLocator[appointment.uniqueId()];
            // is there a current appointment
            if (currentAppointment) {
                if (currentAppointment.jobId >= appointment.jobId) {
                    this.logger.info(appointment.formatLog(`Nonce ${appointment.jobId} is lower than current appointment ${currentAppointment.uniqueId()} nonce ${currentAppointment.jobId}`)); //prettier-ignore
                    return false;
                } else {
                    // remove the old appointment
                    delete this.appointmentsById[currentAppointment.uniqueJobId()];
                }
            }

            // update the db
            const batch = this.db.batch().put(appointment.uniqueJobId(), Appointment.toIAppointment(appointment));
            if (currentAppointment) await batch.del(currentAppointment.uniqueJobId()).write();
            else await batch.write();

            // add the new appointment
            this.appointmentsByStateLocator[appointment.uniqueId()] = appointment;
            this.appointmentsById[appointment.uniqueJobId()] = appointment;
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
            const stateLocator = appointment.uniqueId();
            // remove the appointment from the id index
            delete this.appointmentsById[appointmentId];

            // All updates related to resources related to stateLocator should happen atomically.
            // While the current code is blocking, we acquire a lock until we are done for clarity.
            await this.stateLocatorLockManager.withLock(stateLocator, async () => {
                // remove the appointment from the state locator index
                const currentAppointment = this.appointmentsByStateLocator[stateLocator];
                // if it has the same id
                if (currentAppointment.uniqueJobId() === appointmentId) {
                    delete this.appointmentsByStateLocator[stateLocator];
                }
            });

            // and remove from remote storage
            await this.db.del(appointmentId);
            return true;
        }
        return false;
    }

    public getById(id: string) {
        return this.appointmentsById[id];
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
    public getExpiredSince(expiryBlock: number): Appointment[] {
        return Object.values(this.appointmentsById).filter(a => a.endBlock < expiryBlock);
    }

    /**
     * Get all the appointments in the store
     */
    public getAll(): Appointment[] {
        // all appointments must have expired by the time block number reaches max int
        return this.getExpiredSince(Number.MAX_SAFE_INTEGER);
    }
}
