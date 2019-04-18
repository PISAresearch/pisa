import { IAppointmentStore } from "./store";
import { AppointmentSubscriber } from "./appointmentSubscriber";
import { ethers } from "ethers";
import logger from "../logger";
import { IEthereumAppointment, IAppointment } from "../dataEntities";

/**
 * Scans the current appointments to find expired ones. Upon finding expired appointments it removes them appointment
 * from the store and from the subscriber.
 */
export class AppointmentStoreGarbageCollector {
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
    ) {}

    // only allow the gc to be started once
    private started: boolean = false;
    private listener = (blockNumber: number) => this.removeExpired(blockNumber);
    // only allow one collection at a time
    private collecting = false;
    // we want to record how many consecutive errors have taken place in gc
    private consecutiveErrors = 0;

    /**
     * Start the monitoring for expired appointments
     */
    public start() {
        if (!this.started) {
            this.provider.on("block", this.listener);
            this.started = true;
        }
    }

    /**
     * Stop monitoring for expired events
     */
    public stop() {
        if (this.started) {
            this.started = false;
            this.provider.removeListener("block", this.listener);
        }
    }

    /**
     * Find appointments that have expired then remove them from the subsciber and store.
     * @param blockNumber
     */
    private async removeExpired(blockNumber: number) {
        logger.info(`GC: Block mined ${blockNumber}.`);
        // it is safe for this function to be called concurrently
        // but there's no point, both would try to the same work which is wasteful
        // so we lock here anyway and just wait for the next block
        if (!this.collecting) {
            this.collecting = true;

            try {
                // appointments expire when the current block is greater than their end time
                // find all blocks that are expired
                // we then allow a number of confirmations to ensure that we can safely dispose the block
                logger.info(`GC: Collecting appointments expired since ${blockNumber - this.confirmationCount}.`);
                const expiredAppointments = await this.store.getExpiredSince(blockNumber - this.confirmationCount);

                if (expiredAppointments.length > 0) {
                    logger.info(`GC: Collecting ${expiredAppointments.length} expired appointments.`);

                    // wait for all appointments to be removed from the store and the subscribers
                    await Promise.all(
                        expiredAppointments.map(async a => {
                            await this.store.removeById(a.id);
                            this.appointmentSubscriber.unsubscribe(a.id, a.getEventFilter());
                            logger.info(a.formatLog(`GC: Collected appointment with end: ${a.endBlock}.`));
                        })
                    );
                }

                this.consecutiveErrors = 0;
            } catch (doh) {
                this.consecutiveErrors += 1;
                // an error here means that we were likely unable to collect all, or some of, the appointments
                // consecutive errors could mean we have a systematic problem, or connection issues with the store
                // in either case the problem is very serious - so we stop the GC
                logger.error("GC: Unexpected error.");
                logger.error(`GC: Consecutive errors: ${this.consecutiveErrors}.`);
                logger.error(doh);
            }

            this.collecting = false;
        }
    }
}
