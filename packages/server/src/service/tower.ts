import { AppointmentStore } from "../watcher";
import { ethers } from "ethers";
import { PublicDataValidationError } from "@pisa/errors";
import { SignedAppointment, AppointmentMode, Appointment } from "../dataEntities/appointment";
import { MultiResponder } from "../responder";
import { Logger } from "@pisa/utils";
import { ReadOnlyBlockCache, IBlockStub } from "@pisa/block";

/**
 * A PISA tower, configured to watch for specified appointment types
 */
export class PisaTower {
    constructor(
        private readonly store: AppointmentStore,
        private readonly appointmentSigner: ethers.Wallet,
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
                appointment.gasLimit + MultiResponder.PisaGasAllowance,
                appointment.id,
                appointment.startBlock,
                appointment.startBlock + appointment.challengePeriod
            );
        } else {
            // add this to the store so that other components can pick up on it
            const currentAppointment = this.store.appointmentsByLocator.get(appointment.locator);
            if (!currentAppointment || appointment.nonce > currentAppointment.nonce) {   
                await this.store.addOrUpdateByLocator(appointment);
            } else throw new PublicDataValidationError(`Appointment already exists and nonce too low. Should be greater than ${appointment.nonce}.`); // prettier-ignore
        }

        const digest = ethers.utils.keccak256(appointment.encodeForSig(this.pisaContractAddress));
        const signature = await this.appointmentSigner.signMessage(ethers.utils.arrayify(digest));
        return new SignedAppointment(appointment, this.appointmentSigner.address, signature);
    }
}
