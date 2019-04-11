import { IAppointmentStore } from "./store";
import { AppointmentSubscriber } from "./appointmentSubscriber";
import { ethers } from "ethers";

/**
 * Scans the current appointments to find expired ones. Upon finding expired appointments it removes the appointment
 * from the store and from the subscriber.
 */
export class AppointmentStoreGarbageCollector {
    constructor(
        private readonly provider: ethers.providers.Provider,
        private readonly finalityDepth: number,
        private readonly pollInterval: number,
        private readonly store: IAppointmentStore,
        private readonly appointmentSubscriber: AppointmentSubscriber
    ) {}

    public start() {
        this.poll();
    }

    private wait(timeMs: number) {
        return new Promise(resolve => {
            setTimeout(resolve, timeMs);
        });
    }

    async poll() {
        try {
            // each tick remove any expired appointments
            await this.removeExpired();
        } catch (doh) {
            // 102: stop polling? yes,no,maybe, but we should at least log here
        } finally {
            // wait some period before polling again
            await this.wait(this.pollInterval);
            this.poll();
        }
    }

    async removeExpired() {
        // get the current block number
        const blockNumber = await this.provider.getBlockNumber();
        // find all blocks that are expired past the finality depth
        // 102: currently we're mixing dates and blocks here - decide what it should be and name it appropriately
        const expiredAppointments = await this.store.getExpiredSince(blockNumber - this.finalityDepth);
        // wait for all appointments to be removed from the store and the subscribers
        await Promise.all([
            expiredAppointments.map(async a => {
                await this.store.removeById(a.id);
                this.appointmentSubscriber.unsubscribe(a.id, a.getEventFilter());
            })
        ]);
    }
}
