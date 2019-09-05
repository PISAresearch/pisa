import { AppointmentStore } from "./watcher";
import { ethers } from "ethers";
import { SignedAppointment, Appointment, PublicDataValidationError, IBlockStub } from "./dataEntities";
import { AppointmentMode } from "./dataEntities/appointment";
import { MultiResponder } from "./responder";
import { Logger } from "./logger";
import { ReadOnlyBlockCache } from "./blockMonitor";
import { groupTuples } from "./utils/ethers";

/**
 * A PISA tower, configured to watch for specified appointment types
 */
export class PisaTower {
    constructor(
        private readonly store: AppointmentStore,
        private readonly appointmentSigner: EthereumAppointmentSigner,
        private readonly multiResponder: MultiResponder,
        private readonly blockCache: ReadOnlyBlockCache<IBlockStub>,
        private readonly pisaContractAddress: string
    ) {}

    /**
     * Checks that the object is well formed, that it meets the conditions necessary for watching and assigns it to be watched.
     * @param obj
     */
    public async addAppointment(obj: any, log: Logger): Promise<SignedAppointment> {
        if (!obj) throw new PublicDataValidationError("Json request body empty.");
        const appointment = Appointment.parse(obj, log);
        // check the appointment is valid
        await appointment.validate(this.blockCache, this.pisaContractAddress, log);

        // is this a relay transaction, if so, add it to the responder.
        // if not, add it to the watcher
        if (appointment.mode === AppointmentMode.Relay) {
            await this.multiResponder.startResponse(
                this.multiResponder.pisaContractAddress,
                appointment.encodeForResponse(),
                //TODO:260: this 400000 should be decided centrally elsewhere
                appointment.gasLimit + 400000,
                appointment.id,
                0,
                appointment.challengePeriod
            );
        } else {
            // add this to the store so that other components can pick up on it
            const currentAppointment = this.store.appointmentsByLocator.get(appointment.locator);
            if (!currentAppointment || appointment.nonce > currentAppointment.nonce) {   
                await this.store.addOrUpdateByLocator(appointment);
            } else throw new PublicDataValidationError(`Appointment already exists and nonce too low. Should be greater than ${appointment.nonce}.`); // prettier-ignore
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
    public abstract async signAppointment(appointment: Appointment): Promise<string>;
}

/**
 * This EthereumAppointmentSigner signs appointments using a hot wallet.
 */
export class HotEthereumAppointmentSigner extends EthereumAppointmentSigner {
    constructor(private readonly signer: ethers.Signer, public readonly pisaContractAddress: string) {
        super();
    }

    /**
     * Signs `appointment`. Returns a promise that resolves to the signature of the appointment.
     *
     * @param appointment
     */
    public async signAppointment(appointment: Appointment): Promise<string> {
        const packedData = appointment.encode();
        // now hash the packed data with the address before signing
        const digest = ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
                ...groupTuples([["bytes", packedData], ["address", this.pisaContractAddress]])
            )
        );
        return await this.signer.signMessage(ethers.utils.arrayify(digest));
    }
}
