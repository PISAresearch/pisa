import { EthereumAppointment, PublicDataValidationError, ChannelType } from "./dataEntities";
import { Inspector } from "./inspector";
import { IChannelConfig } from "./integrations";
import { AppointmentStore } from "./watcher";
import { ethers } from "ethers";
import { SignedAppointment } from "./dataEntities/appointment";

/**
 * A PISA tower, configured to watch for specified appointment types
 */
export class PisaTower {
    constructor(
        public readonly provider: ethers.providers.Provider,
        private readonly store: AppointmentStore,
        private readonly appointmentSigner: EthereumAppointmentSigner,
        channelConfigs: IChannelConfig<EthereumAppointment, Inspector<EthereumAppointment>>[]
    ) {
        channelConfigs.forEach(c => (this.configs[c.channelType] = c));
    }

    public configs: {
        [type: string]: IChannelConfig<EthereumAppointment, Inspector<EthereumAppointment>>;
    } = {};

    /**
     * Checks that the object is well formed, that it meets the conditions necessary for watching and assigns it to be watched.
     * @param obj
     */
    public async addAppointment(obj: any): Promise<SignedAppointment> {
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

        // add this to the store so that other components can pick up on it
        await this.store.addOrUpdateByStateLocator(appointment);

        const signature = await this.appointmentSigner.signAppointment(appointment);
        return new SignedAppointment(appointment, signature);
    }
}

/**
 * This class is responsible for signing Ethereum appointments.
 */
export abstract class EthereumAppointmentSigner {
    /**
     * Signs `appointment`. Returns a promise that resolves to the signature of the appointment.
     *
     * @param appointment
     */
    public abstract signAppointment(appointment: EthereumAppointment): Promise<string>;
}

/**
 * This EthereumAppointmentSigner signs appointments using a hot wallet.
 */
export class HotEthereumAppointmentSigner extends EthereumAppointmentSigner {
    constructor(private readonly signer: ethers.Signer) {
        super();
    }

    /**
     * Signs `appointment`. Returns a promise that resolves to the signature of the appointment.
     *
     * @param appointment
     */
    public signAppointment(appointment: EthereumAppointment): Promise<string> {
        const packedData = ethers.utils.solidityPack(
            ["string", "uint", "uint", "uint"],
            [appointment.getStateLocator(), appointment.getStateNonce(), appointment.startBlock, appointment.endBlock]
        );

        const digest = ethers.utils.keccak256(packedData);

        return this.signer.signMessage(digest);
    }
}
