import { EthereumAppointment, PublicDataValidationError, ChannelType } from "./dataEntities";
import { Inspector } from "./inspector";
import { IChannelConfig } from "./integrations";
import { Watcher } from "./watcher";
import { ethers } from "ethers";

/**
 * A PISA tower, configured to watch for specified appointment types
 */
export class PisaTower {
    constructor(
        public readonly provider: ethers.providers.Provider,
        public readonly watcher: Watcher,
        channelConfigs: IChannelConfig<EthereumAppointment, Inspector<EthereumAppointment>>[]
    ) {
        channelConfigs.forEach(c => (this.configs[c.channelType] = c));
    }

    configs: {
        [type: string]: IChannelConfig<EthereumAppointment, Inspector<EthereumAppointment>>;
    } = {};

    /**
     * Checks that the object is well formed, that it meets the conditions necessary for watching and assigns it to be watched.
     * @param obj
     */
    async addAppointment(obj: any) {
        if (!obj) throw new PublicDataValidationError("No content specified.");

        // look for a type argument
        const type = obj["type"];
        const config = this.configs[type];
        if (!config) throw new PublicDataValidationError(`Unknown appointment type ${type}.`);

        // parse the appointment
        const appointment = config.appointment(obj);

        const inspector = config.inspector(config.minimumDisputePeriod, this.provider);
        // inspect this appointment, an error is thrown if inspection is failed
        await inspector.inspectAndPass(appointment);

        // start watching it if it passed inspection
        await this.watcher.addAppointment(appointment);

        return appointment;
    }
}
