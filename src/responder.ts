import { IAppointment } from "./dataEntities/appointment";
import logger from "./logger";
import { ethers } from "ethers";

/**
 * Responsible for responding to observed events.
 * The responder is solely responsible for ensuring that a transaction gets to the blockchain
 */
export class Responder {
    constructor(private readonly retries: number, private readonly signer : ethers.Signer) {}

    // PISA: how does a responder validate it's submit function? should it even?
    /**
     * Execute the submit state function, doesn't throw errors
     * @param submitStateFunction
     */
    async respond(appointment: IAppointment) {
        const contract = new ethers.Contract(
            appointment.getContractAddress(),
            appointment.getContractAbi(),
            this.signer
        );

        try {
            let tries = 0;
            while (tries < this.retries) {
                try {
                    const tx = await appointment.getSubmitStateFunction()(contract);
                    await tx.wait();
                    logger.info(
                        appointment.formatLog(
                            `Successfully responded to ${appointment.getEventName()} for appointment ${appointment.getStateLocator()} after ${tries +
                                1} tr${tries + 1 === 1 ? "y" : "ies"}.`
                        )
                    );
                    return;
                } catch (doh) {
                    // retry
                    logger.error(
                        appointment.formatLog(
                            `Failed to respond to ${appointment.getEventName()} for appointment ${appointment.getStateLocator()}, re-tries ${tries +
                                1}.`
                        )
                    );
                    logger.error(doh);
                    tries++;
                    await wait(1000);
                }
            }

            logger.error(
                `Failed to respond to ${appointment.getEventName()} for appointment ${appointment.getStateLocator()}, after ${tries +
                    1}. Giving up.`
            );
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
