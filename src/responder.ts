import { IAppointment } from "./dataEntities/appointment";
import logger from "./logger";

export class Responder {
    constructor(private readonly retries: number) {}

    // PISA: how does a responder validate it's submit function? should it even?
    /**
     * Execute the submit state function, doesn't throw errors
     * @param submitStateFunction
     */
    async respond(submitStateFunction: () => Promise<any>, appointment: IAppointment) {
        try {
            let tries = 0;
            while (tries < this.retries) {
                try {
                    let tx = await submitStateFunction();
                    await tx.wait();
                    logger.info(`Successfully submitted state after ${tries + 1} tr${tries + 1 === 1 ? "y" : "ies"}.`);
                    return;
                } catch (doh) {
                    // retry
                    logger.error(
                        `Failed to submit state update for channel ${appointment.getChannelIdentifier()}, re-tries ${tries}`
                    );
                    tries++;
                    await wait(1000);
                }
            }

            logger.error("Failed after 10 tries.");
        } catch (bigDoh) {
            logger.error(bigDoh);
        }
    }
}

const wait = (timeout: number) => {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve();
        }, timeout);
    });
};
