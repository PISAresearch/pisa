import { EthereumAppointment, ChannelType } from "./dataEntities";
import { ethers } from "ethers";
import logger from "./logger";

export abstract class Inspector<TAppointment extends EthereumAppointment> {
    protected constructor(public readonly channelType: ChannelType, protected readonly provider: ethers.providers.Provider) {}

    public abstract async checkInspection(appointment): Promise<void>;

    /**
     * Inspects an appointment to decide whether to accept it. Throws on reject.
     * Sets an the result of the inspection on the appointment
     * @param appointment
     */
    async inspectAndPass(appointment: EthereumAppointment): Promise<void> {
        logger.info(appointment.formatLog("Begin inspection."));
        logger.debug(appointment.formatLog(JSON.stringify(appointment)));
        await this.checkInspection(appointment);

        // if we pass the inspection then set the result
        const currentBlock = await this.provider.getBlockNumber()
        appointment.setInspectionResult(true, currentBlock);

        logger.info(
            appointment.formatLog(
                `Passed inspection. Start block: ${appointment.startBlock}. End block: ${appointment.endBlock}.`
            )
        );
    }
}
