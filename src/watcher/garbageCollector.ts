import { IAppointmentStore } from "./store";
import { AppointmentSubscriber } from "./appointmentSubscriber";
import { ethers } from "ethers";
import logger from "../logger";

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

    /**
     * Start the monitoring for expired appointments
     */
    public start() {
        this.provider.on("block", (blockNumber: number) => this.removeExpired(blockNumber));
    }

    private collecting = false;

    /**
     * Find appointments that have expired then remove them from the subsciber and store.
     * @param blockNumber
     */
    private async removeExpired(blockNumber: number) {
        // it is safe for this function to be called concurrently
        // but there's no point, both would try to the same work which is wasteful
        // so we lock here anyway and just wait for the next block
        if (!this.collecting) {
            this.collecting = true;
            
            try {
                // appointments expire when the current block is greater than their end time
                // find all blocks that are expired
                // we then allow a number of confirmations to ensure that we can safely dispose the block
                // 102: currently we're mixing dates and blocks here - decide what it should be and name it appropriately
                const expiredAppointments = await this.store.getExpiredSince(blockNumber - this.confirmationCount);

                if (expiredAppointments.length > 0) {
                    logger.info(`GC: Collecting ${expiredAppointments.length} expired appointments.`);

                    // wait for all appointments to be removed from the store and the subscribers
                    await Promise.all([
                        expiredAppointments.map(async a => {
                            await this.store.removeById(a.id);
                            this.appointmentSubscriber.unsubscribe(a.id, a.getEventFilter());
                        })
                    ]);

                    // log the expired appointmets
                    expiredAppointments.forEach(a =>
                        logger.info(a.formatLog(`GC: Appointment with end: ${a.endTime}.`))
                    );
                }
            } catch (doh) {
                // errors escaping this block will cause unhandled promise rejections so we log and swallow here
                logger.error("GC: Unexpected error.");
                logger.error(doh);
            }

            this.collecting = false;
        }
    }
}
