import { KitsuneAppointment, RaidenAppointment, ChannelType, IAppointment } from "./dataEntities/appointment";
import { ethers } from "ethers";
import logger from "./logger";
import { inspect } from "util";

// PISA: docs and names
class AppointmentStore {
    private readonly channels: {
        [channelIdentifier: string]: {
            contract: ethers.Contract;
            appointment: IAppointment;
            listener: ethers.providers.Listener;
        };
    } = {};

    addOrUpdateAppointment(appointment: IAppointment, contract: ethers.Contract, listener: ethers.providers.Listener) {
        // PISA: is add + error safer here?
        this.channels[appointment.getChannelIdentifier()] = {
            appointment,
            contract,
            listener
        };
    }
    // PISA: figure out when / whether appointment cleanup should happen
    removeAppointment(appointment: IAppointment) {
        this.channels[appointment.getChannelIdentifier()] = undefined;
    }
    getPreviousAppointment(appointment: IAppointment) {
        // PISA: currently this means that we create new contract object unnecessarily
        // PISA: we should also keep a contracts dictionary here
        
        
        // PISA: check the nonce in here! the previous channel should have lower nonce
        return this.channels[appointment.getChannelIdentifier()];
    }
}

// PISA: docs on the new watcher class
export class Watcher {
    public constructor(public readonly provider: ethers.providers.Provider, public readonly signer: ethers.Signer) {}

    readonly store: AppointmentStore = new AppointmentStore();

    // we need to keep a list of appointments - against each contract, so can it have one appointment or
    
    // getNonce() : number {
    //      PISA add this to appointment
    // }


    // PISA: we can throw errors in here now, that should be reflected in pisaservice
    

    /**
     * Watch for an event specified by the appointment, and respond if it the event is raised.
     * @param appointment Contains information about where to watch for events, and what information to suppli as part of a response
     */
    async watch(appointment: IAppointment) {
        // PISA: safety check the appointment - check the inspection time?
        const eventName = appointment.getEventName();

        // create a contract
        // PISA: logging should include!!!!!! appointment.stateUpdate.contractAddress
        // PISA: also this would need inspect
        logger.info(`Begin watching for event ${eventName} in appointment ${appointment}.`);
        logger.debug(`Watching appointment: ${appointment}.`);

        const previousAppointment = this.store.getPreviousAppointment(appointment);
        if (previousAppointment) {
            // PISA: this should be previous filter?
            const filter = previousAppointment.appointment.getEventFilter(previousAppointment.contract);
            previousAppointment.contract.removeListener(filter, previousAppointment.listener);
            logger.info(
                //PISA: better message here - include nonces, contract address and channel identifier
                // PISA: this needs inspect() atm
                `Stopped watching ${previousAppointment.appointment}`
            );
        }

        const contract =
            (previousAppointment && previousAppointment.contract) ||
            new ethers.Contract(appointment.getContractAddress(), appointment.getContractAbi(), this.provider).connect(
                this.signer
            );

        // PISA: called filter here twice - restructure
        const filter = appointment.getEventFilter(contract);

        const listener: ethers.providers.Listener = async (...args: any[]) => {
            // this callback should not throw exceptions as they cannot be handled elsewhere

            try {
                logger.info(
                    `Observed event ${eventName} in contract ${contract.address} with arguments : ${args.slice(
                        0,
                        args.length - 1
                    )}. Beginning response.`
                    // PISA: interesting slice here - debug this and maybe do it another way - or at least encapsulate it
                );
                logger.debug(`Event info ${inspect(args[1])}`);
                const submitStateFunction = appointment.getSubmitStateFunction();
                await submitStateFunction(contract, args);
            } catch (doh) {
                // an error occured whilst responding to the callback - this is serious and the problem needs to be correctly diagnosed
                logger.error(doh);
                logger.error(`Error occured whilst responding to event ${eventName} in contract ${contract.address}.`);
            }

            logger.info(`Successfully responded to ${eventName} in contract ${contract.address}`);
        };

        // watch the supplied event
        contract.once(filter, listener);

        // add the appointment and the contract for later lookup
        this.store.addOrUpdateAppointment(appointment, contract, listener);
    }
}

/**
 * A watcher is responsible for watching for, and responding to, events emitted on-chain.
 */
// export class KitsuneWatcher extends Watcher {
//     constructor(
//         public readonly provider: ethers.providers.Provider,
//         public readonly signer: ethers.Signer // private readonly eventCallback: ( //     contract: ethers.Contract, //     appointment: IAppointment, //     ...args: any[] // ) => Promise<any>
//     ) {
//         super(provider, signer, ChannelType.Kitsune);
//     }
// }

// interface IWatcher {
    // respond(contract: ethers.Contract, appointment: IAppointment, ...args: any[]);
//}

// export class RaidenWatcher extends Watcher implements IWatcher {
//     // PISA: is this constructor really necessary? should be, because of the protected base
//     constructor(readonly provider: ethers.providers.Provider, readonly signer: ethers.Signer) {
//         super(provider, signer, ChannelType.Raiden);
//     }

//     // async respond(contract: ethers.Contract, appointment: IAppointment, ...args: any[]) {
//     //     const raidenAppointment = appointment as RaidenAppointment;

//     //     // PISA: pass this to the responder
//     //     let tx = await contract.updateNonClosingBalanceProof(
//     //         raidenAppointment.stateUpdate.channel_identifier,
//     //         raidenAppointment.stateUpdate.closing_participant,
//     //         raidenAppointment.stateUpdate.non_closing_participant,
//     //         raidenAppointment.stateUpdate.balance_hash,
//     //         raidenAppointment.stateUpdate.nonce,
//     //         raidenAppointment.stateUpdate.additional_hash,
//     //         raidenAppointment.stateUpdate.closing_signature,
//     //         raidenAppointment.stateUpdate.non_closing_signature
//     //     );
//     //     await tx.wait();
//     // }
// }

const wait = (timeout: number) => {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve();
        }, timeout);
    });
};
