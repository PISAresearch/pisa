import { IAppointmentStore } from "./store";
import { AppointmentSubscriber } from "./appointmentSubscriber";
import { ethers } from "ethers";
import { StartStopService } from "../dataEntities";

/**
 * Scans the current appointments to find expired ones. Upon finding expired appointments it removes them appointment
 * from the store and from the subscriber.
 */
export class AppointmentStoreGarbageCollector extends StartStopService {
    /**
     * Scans the current appointments to find expired ones. Upon finding expired appointments it removes them appointment
     * from the store and from the subscriber.
     * @param provider Used to monitor the blockchain for new blocks
     * @param confirmationCount The number of confirmation window allowed to gain certainty that an appointment has indeed expired
     * @param store The store to update when appointments expire
     * @param appointmentSubscriber The subscriber to update when appointments expire
     */
    constructor(
        private readonly provider: ethers.providers.Provider,
        private readonly confirmationCount: number,
        private readonly store: IAppointmentStore,
        private readonly appointmentSubscriber: AppointmentSubscriber
    ) {
        super("GC");
    }

    // only allow one collection at a time
    private collecting = false;
    // we want to record how many consecutive errors have taken place in gc
    private consecutiveErrors = 0;
    // the remove expired since function bound to this gc
    public boundExpired = this.removeExpiredSince.bind(this);

    /**
     * Start the monitoring for expired appointments
     */
    protected async startInternal() {
        this.provider.on("block", this.boundExpired);
    }

    /**
     * Stop monitoring for expired events
     */
    protected async stopInternal() {
        this.provider.removeListener("block", this.boundExpired);
    }

    /**
     * Find appointments that have expired then remove them from the subscriber and store.
     * @param blockNumber
     */
    public async removeExpiredSince(blockNumber: number) {
        this.logger.info(`GC: Block mined ${blockNumber}.`);
        // it is safe for this function to be called concurrently
        // but there's no point, both would try to the same work which is wasteful
        // so we lock here anyway and just wait for the next block
        if (!this.collecting) {
            this.collecting = true;

            try {
                // appointments expire when the current block is greater than their end time
                // find all blocks that are expired
                // we then allow a number of confirmations to ensure that we can safely dispose the block
                this.logger.info(`GC: Collecting appointments expired since ${blockNumber - this.confirmationCount}.`);
                const expiredAppointments = this.store.getExpiredSince(blockNumber - this.confirmationCount);
                if (expiredAppointments.length > 0) {
                    this.logger.info(`GC: Collecting ${expiredAppointments.length} expired appointments.`);

                    // wait for all appointments to be removed from the store and the subscribers
                    await Promise.all(
                        expiredAppointments.map(async a => {
                            await this.store.removeById(a.id);
                            this.appointmentSubscriber.unsubscribe(a.id, a.getEventFilter());
                            this.logger.info(a.formatLog(`GC: Collected appointment with end: ${a.endBlock}.`));
                        })
                    );
                }

                this.consecutiveErrors = 0;
            } catch (doh) {
                this.consecutiveErrors += 1;
                // an error here means that we were likely unable to collect all, or some of, the appointments
                // consecutive errors could mean we have a systematic problem, or connection issues with the store
                // in either case the problem is very serious - so we stop the GC
                this.logger.error("GC: Unexpected error.");
                this.logger.error(`GC: Consecutive errors: ${this.consecutiveErrors}.`);
                this.logger.error(doh);
            } finally {
                this.collecting = false;
            }
        }
    }
}
