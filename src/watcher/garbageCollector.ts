import { IAppointmentStore } from "./store";
import { AppointmentSubscriber } from "./appointmentSubscriber";
import { ethers } from "ethers";

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

    private async removeExpired(blockNumber: number) {
        try {
            // 102: this needs to be wrapped in a catch
        }
        finally{}

        // appointments expire when the current block is greater than their end time
        // find all blocks that are expired past the finality depth
        // we then allow a number of confirmations to ensure that we can safely dispose the block
        // 102: currently we're mixing dates and blocks here - decide what it should be and name it appropriately
        const expiredAppointments = await this.store.getExpiredSince(blockNumber - this.confirmationCount);
        // wait for all appointments to be removed from the store and the subscribers
        await Promise.all([
            expiredAppointments.map(async a => {
                await this.store.removeById(a.id);
                this.appointmentSubscriber.unsubscribe(a.id, a.getEventFilter());
            })
        ]);
    }
}
