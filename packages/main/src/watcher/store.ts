import { ApplicationError } from "@pisa/errors";
import { StartStopService, LockManager, MapOfSets } from "@pisa/utils";
import { LevelUp } from "levelup";
import { Appointment, IAppointment } from "../dataEntities/appointment";
import EncodingDown from "encoding-down";
const sub = require("subleveldown");

/**
 * Stores all appointments in memory and in the db. Has an inefficient processes for
 * determining expired appointments so this function should not be used in a loop.
 */
export class AppointmentStore extends StartStopService {
    private readonly subDb: LevelUp<EncodingDown<string, any>>;
    constructor(db: LevelUp<EncodingDown<string, any>>) {
        super("appointment-store");
        this.subDb = sub(db, `watcher`, { valueEncoding: "json" });
    }

    protected async startInternal() {
        // access the db and load all state
        for await (const record of this.subDb.createValueStream()) {
            const appointment = Appointment.fromIAppointment((record as any) as IAppointment);
            // add to the indexes
            this.mAppointmentsById.set(appointment.id, appointment);
            this.mAppointmentsByLocator.set(appointment.locator, appointment);
            this.mAppointmentsByCustomerAddress.addToSet(appointment.customerAddress, appointment);
        }
    }

    protected async stopInternal() {
        // do nothing
    }

    /**
     * Accessor to the appointments, indexed by locator.
     */
    public get appointmentsByLocator(): ReadonlyMap<string, Appointment> {
        return this.mAppointmentsByLocator;
    }
    private readonly mAppointmentsByLocator: Map<string, Appointment> = new Map();

    /**
     * Accessor to the appointments in this store, indexed by id.
     */
    public get appointmentsById(): ReadonlyMap<string, Appointment> {
        return this.mAppointmentsById;
    }
    private readonly mAppointmentsById: Map<string, Appointment> = new Map();

    /**
     * Accessor to the appointments, indexed by customerAddress.
     */
    public get appointmentsByCustomerAddress(): ReadonlyMap<string, ReadonlySet<Appointment>> {
        return this.mAppointmentsByCustomerAddress;
    }
    private readonly mAppointmentsByCustomerAddress: MapOfSets<string, Appointment> = new MapOfSets();

    // Every time we access the state locator, we need to make sure that this happens atomically.
    // This is not necessary for appointmentId, as they are unique for each appointment and generated internally.
    // Instead, multiple appointments can share the same state locator.
    private stateLocatorLockManager = new LockManager();

    /**
     * Checks to see if an appointment with the current locator exists. If it does
     * exist the current appointment is updated iff it has a lower nonce than the supplied
     * appointment. If it does not exist a new appointment is added in the store.
     * Throws exception if the suppled appointment had the same locator as an existing appointment
     * but lower nonce.
     * @param appointment
     */
    public addOrUpdateByLocator(appointment: Appointment): Promise<void> {
        // As we are accessing data structures by state locator, we make sure to acquire a lock on it
        return this.stateLocatorLockManager.withLock(appointment.locator, async () => {
            const currentAppointment = this.mAppointmentsByLocator.get(appointment.locator);

            const batch = this.subDb.batch();
            // CHECKS
            if (currentAppointment) {
                // make sure that the nonce is larger than the previous one
                if (appointment.nonce <= currentAppointment.nonce) {
                    throw new ApplicationError(appointment.formatLog(`Nonce ${appointment.nonce} is not larger than current appointment ${currentAppointment.locator} nonce ${currentAppointment.nonce}`)) //prettier-ignore
                }

                batch.del(currentAppointment.id);
            }

            batch.put(appointment.id, Appointment.toIAppointment(appointment));

            // DB
            await batch.write();

            // MEMORY
            if (currentAppointment) {
                this.mAppointmentsById.delete(currentAppointment.id);
                this.mAppointmentsByCustomerAddress.deleteFromSet(appointment.customerAddress, currentAppointment);
            }
            this.mAppointmentsByLocator.set(appointment.locator, appointment);
            this.mAppointmentsById.set(appointment.id, appointment);
            this.mAppointmentsByCustomerAddress.addToSet(appointment.customerAddress, appointment);
        });
    }

    /**
     * Remove an appointment if one exists for this id. Does nothing if an appointment does not
     * exist. Returns true if an item existed and was deleted.
     * @param appointmentId
     */
    public async removeById(appointmentId: string): Promise<boolean> {
        const appointment = this.mAppointmentsById.get(appointmentId);
        if (appointment) {
            // DB
            await this.subDb.del(appointmentId);

            // MEMORY
            const stateLocator = appointment.locator;
            // remove the appointment from the id index
            this.mAppointmentsById.delete(appointmentId);

            // All updates related to resources related to stateLocator should happen atomically.
            // While the current code is blocking, we acquire a lock until we are done for clarity.
            await this.stateLocatorLockManager.withLock(stateLocator, async () => {
                // remove the appointment from the state locator index
                const currentAppointment = this.mAppointmentsByLocator.get(stateLocator);
                if (!currentAppointment) throw new ApplicationError(`Missing locator ${stateLocator} for id ${appointmentId}.`); // prettier-ignore
                // if it has the same id
                if (currentAppointment.id === appointmentId) {
                    this.mAppointmentsByLocator.delete(stateLocator);
                }

                // this can throw an exception if we call delete in the wrong order - so it should go inside this lock
                // to ensure consistency
                this.mAppointmentsByCustomerAddress.deleteFromSet(appointment.customerAddress, appointment);
            });

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
    public *getExpiredSince(expiryBlock: number): IterableIterator<Appointment> {
        for (const appointment of this.appointmentsById.values()) {
            if (appointment.endBlock < expiryBlock) {
                yield appointment;
            }
        }
    }

    /**
     * Get all the appointments in the store
     */
    public getAll(): Appointment[] {
        // all appointments must have expired by the time block number reaches max int
        return [...this.getExpiredSince(Number.MAX_SAFE_INTEGER)];
    }
}
