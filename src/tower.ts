import { AppointmentStore } from "./watcher";
import { ethers } from "ethers";
import { SignedAppointment, IAppointment, Appointment, PublicDataValidationError } from "./dataEntities";
import { AppointmentMode } from "./dataEntities/appointment";
import { MultiResponder } from "./responder";

/**
 * A PISA tower, configured to watch for specified appointment types
 */
export class PisaTower {
    constructor(
        public readonly provider: ethers.providers.Provider,
        private readonly store: AppointmentStore,
        private readonly appointmentSigner: EthereumAppointmentSigner,
        private readonly multiResponder: MultiResponder
    ) {}

    /**
     * Checks that the object is well formed, that it meets the conditions necessary for watching and assigns it to be watched.
     * @param obj
     */
    public async addAppointment(obj: any): Promise<SignedAppointment> {
        if (!obj) throw new PublicDataValidationError("Json request body empty.");
        const appointment = Appointment.validate(obj);

        // is this a relay transaction, if so, add it to the responder.
        // if not, add it to the watcher
        if (appointment.mode === AppointmentMode.Relay) {
            this.multiResponder.startResponse(appointment);
        }
        else {
            // add this to the store so that other components can pick up on it
            const currentAppointment = this.store.appointmentsByLocator.get(appointment.locator);
            if (!currentAppointment || currentAppointment.jobId >= appointment.jobId) {
                await this.store.addOrUpdateByLocator(appointment);
            } else throw new PublicDataValidationError(`Job id too low. Should be greater than ${appointment.jobId}.`);
        }

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
    public abstract async signAppointment(appointment: IAppointment): Promise<string>;
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
    public async signAppointment(appointment: Appointment): Promise<string> {
        const packedData = appointment.solidityPacked();
        const digest = ethers.utils.keccak256(packedData);
        return await this.signer.signMessage(digest);
    }
}
