import { KitsuneAppointment, RaidenAppointment, ChannelType, IAppointment } from "./dataEntities/appointment";
import { ethers } from "ethers";
import { KitsuneTools } from "./kitsuneTools";
import logger from "./logger";
import { inspect } from "util";
import RaidenContracts from "./raiden_data.json";
const tokenNetworkAbi = RaidenContracts.contracts.TokenNetwork.abi;

class AppointmentStore {
    // a list of contracts - each has a list of appointments
    channels: {
        [channelIdentifier: string]: {
            contract: ethers.Contract;
            appointment: IAppointment;
            listener: ethers.providers.Listener;
        };
    } = {};

    addOrUpdateAppointment(appointment: IAppointment, contract: ethers.Contract, listener: ethers.providers.Listener) {
        // PISA: is add + error safer here?
        this.channels[appointment.channelIdentifier()] = {
            appointment,
            contract,
            listener
        };
    }
    // PISA: figure out when / whether appointment cleanup should happen
    removeAppointment(appointment: IAppointment) {
        this.channels[appointment.channelIdentifier()] = undefined;
    }
    getPreviousAppointment(appointment: IAppointment) {
        // PISA: currently this means that we create new contract object unnecessarily
        // PISA: we should also keep a contracts dictionary here

        return this.channels[appointment.channelIdentifier()];
    }
}

// PISA: docs on the new watcher classes

export abstract class Watcher implements IWatcher {
    protected constructor(
        public readonly provider: ethers.providers.Provider,
        public readonly signer: ethers.Signer,
        public readonly channelType: ChannelType
    ) {}

    store: AppointmentStore = new AppointmentStore();

    // we need to keep a list of appointments - against each contract, so can it have one appointment or

    abstract getEventName(appointment: IAppointment): string;
    abstract getEventFilter(contract: ethers.Contract, appointment: IAppointment): ethers.EventFilter;
    abstract getNewContract(appointment: IAppointment): ethers.Contract;
    abstract respond(contract: ethers.Contract, appointment: IAppointment, ...args: any[]);

    // getNonce() : number {
    //      PISA add this to appointment
    // }
    /**
     * Watch for an event specified by the appointment, and respond if it the event is raised.
     * @param appointment Contains information about where to watch for events, and what information to suppli as part of a response
     */
    async watch(appointment: IAppointment) {
        if (appointment.type !== this.channelType)
            throw new Error(`Incorrect appointment type ${appointment.type} in watcher type ${this.channelType}`);

        // PISA: safety check the appointment - check the inspection time?
        let eventName = this.getEventName(appointment);

        // create a contract
        // PISA: logging should include!!!!!! appointment.stateUpdate.contractAddress
        // PISA: also this would need inspect
        logger.info(`Begin watching for event ${eventName} in appointment ${appointment}.`);
        logger.debug(`Watching appointment: ${appointment}.`);

        const previousAppointment = this.store.getPreviousAppointment(appointment);
        if(previousAppointment) {
            // PISA: this should be previous filter?
            const filter = this.getEventFilter(previousAppointment.contract, appointment);
            previousAppointment.contract.removeListener(filter, previousAppointment.listener)
            logger.info(
                //PISA: better message here - include nonces, contract address and channel identifier
                // PISA: this needs inspect() atm
                `Stopped watching ${previousAppointment.appointment}`
            );
        }

        const contract = (previousAppointment && previousAppointment.contract) || this.getNewContract(appointment);
        // PISA: called filter here twice - restructure
        const filter = this.getEventFilter(contract, appointment);

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
                this.respond(contract, appointment, args);
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
export class KitsuneWatcher extends Watcher {
    constructor(
        public readonly provider: ethers.providers.Provider,
        public readonly signer: ethers.Signer // private readonly eventCallback: ( //     contract: ethers.Contract, //     appointment: IAppointment, //     ...args: any[] // ) => Promise<any>
    ) {
        super(provider, signer, ChannelType.Kitsune);
    }

    getEventName(appointment: IAppointment) {
        return "EventDispute(uint256)";
    }

    getEventFilter(contract: ethers.Contract, appointment: IAppointment) {
        return contract.filters.EventDispute(null);
    }

    getNewContract(appointment: IAppointment) {
        const kitsuneAppointment = appointment as KitsuneAppointment;
        return new ethers.Contract(
            kitsuneAppointment.stateUpdate.contractAddress,
            KitsuneTools.ContractAbi,
            this.provider
        ).connect(this.signer);
    }

    async respond(contract: ethers.Contract, appointment: IAppointment, ...args: any[]) {
        const kitsuneAppointment = appointment as KitsuneAppointment;
        await KitsuneTools.respond(contract, kitsuneAppointment, ...args);
    }
}

interface IWatcher {
    getEventName(appointment: IAppointment): string;
    
    getEventFilter(contract: ethers.Contract, appointment: IAppointment): ethers.EventFilter;
    getNewContract(appointment: IAppointment): ethers.Contract;
    respond(contract: ethers.Contract, appointment: IAppointment, ...args: any[]);
    
}

export class RaidenWatcher extends Watcher implements IWatcher {
    // PISA: is this constructor really necessary? should be, because of the protected base
    constructor(readonly provider: ethers.providers.Provider, readonly signer: ethers.Signer) {
        super(provider, signer, ChannelType.Raiden);
    }

    getEventName(appointment: RaidenAppointment): string {
        //PISA: can these be safely removed? seems like very weak typing...
        let raidenAppointment = appointment as RaidenAppointment;
        return `ChannelClosed - ${raidenAppointment.stateUpdate.channel_identifier} - ${
            raidenAppointment.stateUpdate.closing_participant
        } - ${raidenAppointment.stateUpdate.nonce}`;
    }

    getEventFilter(contract: ethers.Contract, appointment: IAppointment) {
        const raidenAppointment = appointment as RaidenAppointment;
        return contract.filters.ChannelClosed(
            raidenAppointment.stateUpdate.channel_identifier,
            raidenAppointment.stateUpdate.closing_participant,
            null
        );
    }

    getNewContract(appointment: IAppointment) {
        const raidenAppointment = appointment as RaidenAppointment;
        return new ethers.Contract(
            raidenAppointment.stateUpdate.token_network_identifier,
            tokenNetworkAbi,
            this.provider
        ).connect(this.signer);
    }

    async respond(contract: ethers.Contract, appointment: IAppointment, ...args: any[]) {
        const raidenAppointment = appointment as RaidenAppointment;

        // PISA: pass this to the responder
        let tx = await contract.updateNonClosingBalanceProof(
            raidenAppointment.stateUpdate.channel_identifier,
            raidenAppointment.stateUpdate.closing_participant,
            raidenAppointment.stateUpdate.non_closing_participant,
            raidenAppointment.stateUpdate.balance_hash,
            raidenAppointment.stateUpdate.nonce,
            raidenAppointment.stateUpdate.additional_hash,
            raidenAppointment.stateUpdate.closing_signature,
            raidenAppointment.stateUpdate.non_closing_signature
        );
        await tx.wait();
    }
}

const wait = (timeout: number) => {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve();
        }, timeout);
    });
};
