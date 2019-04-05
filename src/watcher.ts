import { IAppointment } from "./dataEntities/appointment";
import { ethers } from "ethers";
import logger from "./logger";
import { inspect } from "util";
import { Responder } from "./responder";
import { PublicInspectionError, ConfigurationError } from "./dataEntities/errors";
import ReadWriteLock from "rwlock";

/**
 * Watches the chain for events related to the supplied appointments. When an event is noticed data is forwarded to the
 * supplied responder to complete the task. The watcher is not responsible for ensuring that observed events are properly
 * acted upon, that is the responsibility of the responder.
 */
export class Watcher {
    public constructor(
        public readonly provider: ethers.providers.Provider,
        public readonly signer: ethers.Signer,
        public readonly responder: Responder
    ) {}
    private readonly store: WatchedAppointmentStore = new WatchedAppointmentStore();
    private readonly lock = new ReadWriteLock();

    /**
     * Start watch for an event specified by the appointment, and respond if it the event is raised.
     * @param appointment Contains information about where to watch for events, and what information to suppli as part of a response
     */
    addAppointment(appointment: IAppointment) {
        // PISA: this lock is the hammer approach. Really we should more carefully consider the critical sections below,
        // PISA: but for now we just allow one appointment to be added at a time
        this.lock.writeLock(release => {
            const timeNow = Date.now();
            if (!appointment.passedInspection) throw new ConfigurationError(`Inspection not passed.`);
            if (appointment.startTime > timeNow || appointment.endTime <= timeNow) {
                throw new ConfigurationError(
                    `Time now: ${timeNow} is not between start time: ${appointment.startTime} and end time ${
                        appointment.endTime
                    }.`
                );
            }

            logger.info(appointment.formatLog(`Begin watching for event ${appointment.getEventName()}.`));

            // if there's a previous appointment for this channel/user, we remove it from the store
            const previousAppointment = this.store.getPreviousAppointmentForChannel(appointment);
            let contract;
            if (previousAppointment) {
                const previousFilter = previousAppointment.appointment.getEventFilter(previousAppointment.contract);
                previousAppointment.contract.removeListener(previousFilter, previousAppointment.listener);
                logger.info(
                    appointment.formatLog(
                        `Stopped watching appointment: ${previousAppointment.appointment.getStateIdentifier()}.`
                    )
                );

                contract = previousAppointment.contract;
            } else {
                // is just the contract already in the store even though a previous appointment isn't?
                // if so we can re-use it for multiple listeners
                const existingContract = this.store.getStoredContract(appointment.getContractAddress());
                if (existingContract) contract = existingContract;
                else {
                    // else create a new contract
                    contract = new ethers.Contract(
                        appointment.getContractAddress(),
                        appointment.getContractAbi(),
                        this.provider
                    ).connect(this.signer);
                }
            }

            // set up the new listener
            const filter = appointment.getEventFilter(contract);
            const listener: ethers.providers.Listener = async (...args: any[]) => {
                // this callback should not throw exceptions as they cannot be handled elsewhere
                try {
                    logger.info(
                        appointment.formatLog(
                            `Observed event ${appointment.getEventName()} in contract ${
                                contract.address
                            } with arguments : ${args.slice(0, args.length - 1)}.`
                        )
                    );
                    logger.debug(`Event info: ${inspect(args)}`);
                    const submitStateFunction = appointment.getSubmitStateFunction();
                    const bufferedFunction = async () => await submitStateFunction(contract);

                    // pass the response to the responder to complete. At this point the job has completed as far as
                    // the watcher is concerned, therefore although respond is an async function we do not need to await it for a result
                    this.responder.respond(bufferedFunction, appointment);

                    // after firing a response we can remove the appointment
                    this.store.removeAppointment(appointment);
                } catch (doh) {
                    // an error occured whilst responding to the callback - this is serious and the problem needs to be correctly diagnosed
                    logger.error(
                        appointment.formatLog(
                            `An unexpected errror occured whilst responding to event ${appointment.getEventName()} in contract ${
                                contract.address
                            }.`
                        )
                    );
                    logger.error(appointment.formatLog(doh));
                }
            };

            // watch the supplied event
            contract.once(filter, listener);

            // add the appointment and the contract for later lookup
            this.store.addOrUpdateAppointment(appointment, contract, listener);

            // release the lock
            release();
        });
    }
}

/**
 * A store of the current appointments being watched.
 */
class WatchedAppointmentStore {
    private readonly contracts: {
        [contractAddress: string]: {
            appointmentReferences: number;
            contract: ethers.Contract;
        };
    } = {};

    private readonly channels: {
        [channelIdentifier: string]: {
            appointment: IAppointment;
            listener: ethers.providers.Listener;
        };
    } = {};

    /**
     * Adds an appointment to the store, or updates an existing appointment if one exists with a lower nonce
     * @param appointment
     * @param contract
     * @param listener
     */
    addOrUpdateAppointment(appointment: IAppointment, contract: ethers.Contract, listener: ethers.providers.Listener) {
        const appointmentAndListener = this.channels[appointment.getStateLocator()];

        if (!appointmentAndListener) {
            // if the contract already exists increment the count, otherwise add the contract
            const contractAndCount = this.contracts[appointment.getContractAddress()];
            if (contractAndCount) contractAndCount.appointmentReferences = contractAndCount.appointmentReferences + 1;
            else {
                this.contracts[appointment.getContractAddress()] = {
                    contract,
                    appointmentReferences: 1
                };
            }
        }
        // added nonce should be strictly greater than current nonce
        else if (appointmentAndListener.appointment.getStateNonce() >= appointment.getStateNonce()) {
            logger.error(
                appointment.formatLog(
                    `Nonce ${appointment.getStateNonce()} is not greater than current appointment ${appointmentAndListener.appointment.getStateLocator()} nonce ${appointmentAndListener.appointment.getStateNonce()}.`
                )
            );
            // PISA: if we've been given a nonce lower than the one we have already we should silently swallow it, not throw an error
            // PISA: this is because we shouldn't be giving out information about what appointments are already in place
            // PISA: we throw an error for now, with low information, but this should be removed.
            throw new PublicInspectionError(`Nonce too low.`);
        }

        this.channels[appointment.getStateLocator()] = { appointment, listener };
    }

    /**
     * Remove an appointment from the store. Also removes contract the corresponding contract if it is no longer referenced
     * by any existing appointments.
     * @param appointment
     */
    removeAppointment(appointment: IAppointment) {
        // remove the appointment
        this.channels[appointment.getStateLocator()] = undefined;

        // and remove the contract if necessary
        const contractAndCount = this.contracts[appointment.getContractAddress()];
        if (contractAndCount.appointmentReferences === 1) this.contracts[appointment.getContractAddress()] = undefined;
        else contractAndCount.appointmentReferences = contractAndCount.appointmentReferences - 1;
    }

    /**
     * Check the store to see if an existing appointment has the same locator, but with a lower nonce;
     * @param contractAddress
     * @param channelLocator
     * @param nonce
     */
    getPreviousAppointmentForChannel(currentAppointment: IAppointment) {
        // get the stored contract, if there isn't one there cant be an appointment either
        const contract = this.getStoredContract(currentAppointment.getContractAddress());
        if (!contract) return undefined;

        const appointmentAndListener = this.channels[currentAppointment.getStateLocator()];
        if (appointmentAndListener) {
            if (appointmentAndListener.appointment.getStateNonce() <= currentAppointment.getStateNonce()) {
                logger.error(
                    currentAppointment.formatLog(
                        `Nonce ${currentAppointment.getStateNonce()} is not greater than current appointment ${appointmentAndListener.appointment.getStateLocator()} nonce ${appointmentAndListener.appointment.getStateNonce()}.`
                    )
                );
                // PISA: if we've been given a nonce lower than the one we have already we should silently swallow it, not throw an error
                // PISA: this is because we shouldn't be giving out information about what appointments are already in place
                // PISA: we throw an error for now, with low information, but this should be removed.
                throw new PublicInspectionError(`Nonce too low.`);
            }
        }

        return { contract, ...appointmentAndListener };
    }
    getStoredContract(contractAddress: string): ethers.Contract {
        const contractAndCount = this.contracts[contractAddress];
        return contractAndCount && contractAndCount.contract;
    }
}
