import { IKitsuneAppointment, IRaidenAppointment, ChannelType, IAppointment } from "./dataEntities/appointment";
import { ethers } from "ethers";
import { KitsuneTools } from "./kitsuneTools";
import logger from "./logger";
import { inspect } from "util";
import RaidenContracts from "./raiden_data.json";
const tokenNetworkAbi = RaidenContracts.contracts.TokenNetwork.abi;

// PISA: docs on the new watcher classes

export abstract class MergedWatcher implements IWatcher {
    protected constructor(
        public readonly provider: ethers.providers.Provider,
        public readonly signer: ethers.Signer,
        public readonly channelType: ChannelType
    ) {}

    // we need to keep a list of appointments - against each contract, so can it have one appointment or

    // get previous appointment
    abstract getEventName(appointment: IAppointment): string;
    abstract getExistingContract(appointment: IAppointment): ethers.Contract;
    abstract getPreviousAppointment(
        appointment: IAppointment
    ): { appointment: IAppointment; listener: ethers.providers.Listener };
    abstract getEventFilter(contract: ethers.Contract, appointment: IAppointment): ethers.EventFilter;
    abstract getNewContract(appointment: IAppointment): ethers.Contract;
    abstract respond(contract: ethers.Contract, appointment: IAppointment, ...args: any[]);
    abstract addContract(appointment: IAppointment, contract: ethers.Contract);
    abstract addAppointment(appointment: IAppointment, listener: ethers.providers.Listener);

    // getNonce() : number {
    //      PISA add this to appointment
    // }

    // getContractAddress() : number {
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

        let existingContract = this.getExistingContract(appointment);
        if (existingContract) {
            // is there a previous appointment
            const existingAppointment = this.getPreviousAppointment(appointment);
            const filter = this.getEventFilter(existingContract, appointment);
            // PISA: need check the nonces are increasing here
            existingContract.removeListener(filter, existingAppointment.listener);
            logger.info(
                //PISA: better message here - include nonces, contract address and channel identifier
                // PISA: this needs inspect() atm
                `Stopped watching ${existingAppointment.appointment}`
            );
        }

        const contract = existingContract || this.getNewContract(appointment);
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
        };

        // watch the supplied event
        contract.once(filter, listener);

        // add the appointment and the contract for later lookup
        this.addContract(appointment, contract);
        this.addAppointment(appointment, listener);
    }
}

/**
 * A watcher is responsible for watching for, and responding to, events emitted on-chain.
 */
export class KitsuneWatcher extends MergedWatcher {
    contracts: {
        [channelAddress: string]: {
            contract: ethers.Contract;
            appointment: { appointment: IAppointment; listener: ethers.providers.Listener };
        };
    } = {};

    constructor(
        public readonly provider: ethers.providers.Provider,
        public readonly signer: ethers.Signer // private readonly eventCallback: ( //     contract: ethers.Contract, //     appointment: IAppointment, //     ...args: any[] // ) => Promise<any>
    ) {
        super(provider, signer, ChannelType.Kitsune);
    }

    getEventName(appointment: IAppointment) {
        return "EventDispute(uint256)";
    }

    getExistingContract(appointment: IAppointment) {
        const kitsuneAppointment = appointment as IKitsuneAppointment;
        // PISA: undefined?
        let lookup = this.contracts[kitsuneAppointment.stateUpdate.contractAddress];
        if (lookup) return lookup.contract;
    }

    getPreviousAppointment(appointment: IAppointment) {
        const kitsuneAppointment = appointment as IKitsuneAppointment;
        // PISA: undefined?
        let lookup = this.contracts[kitsuneAppointment.stateUpdate.contractAddress];
        if (lookup) return lookup.appointment;
    }

    getEventFilter(contract: ethers.Contract, appointment: IAppointment) {
        return contract.filters.EventDispute(null);
    }

    getNewContract(appointment: IAppointment) {
        const kitsuneAppointment = appointment as IKitsuneAppointment;
        return new ethers.Contract(
            kitsuneAppointment.stateUpdate.contractAddress,
            KitsuneTools.ContractAbi,
            this.provider
        ).connect(this.signer);
    }

    async respond(contract: ethers.Contract, appointment: IAppointment, ...args: any[]) {
        const kitsuneAppointment = appointment as IKitsuneAppointment;
        await KitsuneTools.respond(contract, kitsuneAppointment, ...args);
    }

    addContract(appointment: IAppointment, contract: ethers.Contract) {
        const kitsuneAppointment = appointment as IKitsuneAppointment;
        this.contracts[kitsuneAppointment.stateUpdate.contractAddress] = {
            contract: contract,
            appointment: { appointment: undefined, listener: undefined }
        };
    }

    addAppointment(appointment: IAppointment, listener: ethers.providers.Listener) {
        const kitsuneAppointment = appointment as IKitsuneAppointment;
        this.contracts[kitsuneAppointment.stateUpdate.contractAddress].appointment = {
            appointment: appointment,
            listener: listener
        };
    }
}

interface IWatcher {
    getEventName(appointment: IAppointment): string;
    getExistingContract(appointment: IAppointment): ethers.Contract;
    getPreviousAppointment(
        appointment: IAppointment
    ): { appointment: IAppointment; listener: ethers.providers.Listener };
    getEventFilter(contract: ethers.Contract, appointment: IAppointment): ethers.EventFilter;
    getNewContract(appointment: IAppointment): ethers.Contract;
    respond(contract: ethers.Contract, appointment: IAppointment, ...args: any[]);
    addContract(appointment: IAppointment, contract: ethers.Contract);
    addAppointment(appointment: IAppointment, listener: ethers.providers.Listener);
}

export class RaidenWatcher extends MergedWatcher implements IWatcher {
    contracts: {
        [tokenNetworkIdentifier: string]: {
            contract: ethers.Contract;
            appointments: {
                [channelIdentifier: number]: { appointment: IRaidenAppointment; listener: ethers.providers.Listener };
            };
        };
    } = {};

    // PISA: is this constructor really necessary? should be, because of the protected base
    constructor(readonly provider: ethers.providers.Provider, readonly signer: ethers.Signer) {
        super(provider, signer, ChannelType.Raiden);
    }

    getEventName(appointment: IRaidenAppointment): string {
        //PISA: can these be safely removed? seems like very weak typing...
        let raidenAppointment = appointment as IRaidenAppointment;
        return `ChannelClosed - ${raidenAppointment.stateUpdate.channel_identifier} - ${
            raidenAppointment.stateUpdate.closing_participant
        } - ${raidenAppointment.stateUpdate.nonce}`;
    }

    getExistingContract(appointment: IAppointment): ethers.Contract {
        const raidenAppointment = appointment as IRaidenAppointment;
        let lookup = this.contracts[raidenAppointment.stateUpdate.token_network_identifier];

        // PISA: create a type for the lookup - return that
        if (lookup) return lookup.contract;
    }

    getPreviousAppointment(appointment: IAppointment) {
        const raidenAppointment = appointment as IRaidenAppointment;
        let lookup = this.contracts[raidenAppointment.stateUpdate.token_network_identifier];

        //PISA: unsafe
        return lookup.appointments[raidenAppointment.stateUpdate.channel_identifier];
    }

    getEventFilter(contract: ethers.Contract, appointment: IAppointment) {
        const raidenAppointment = appointment as IRaidenAppointment;
        return contract.filters.ChannelClosed(
            raidenAppointment.stateUpdate.channel_identifier,
            raidenAppointment.stateUpdate.closing_participant,
            null
        );
    }

    getNewContract(appointment: IAppointment) {
        const raidenAppointment = appointment as IRaidenAppointment;
        return new ethers.Contract(
            raidenAppointment.stateUpdate.token_network_identifier,
            tokenNetworkAbi,
            this.provider
        ).connect(this.signer);
    }

    async respond(contract: ethers.Contract, appointment: IAppointment, ...args: any[]) {
        const raidenAppointment = appointment as IRaidenAppointment;

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

    addContract(appointment: IAppointment, contract: ethers.Contract) {
        // PISA: this doesnt need to be called if the contract is already in the list!
        const raidenAppointment = appointment as IRaidenAppointment;
        this.contracts[raidenAppointment.stateUpdate.token_network_identifier] = {
            contract: contract,
            appointments: {}
        };
    }

    addAppointment(appointment: IAppointment, listener: ethers.providers.Listener) {
        const raidenAppointment = appointment as IRaidenAppointment;
        const appointments = this.contracts[raidenAppointment.stateUpdate.token_network_identifier].appointments;

        // PISA: unsafe - currently dependent on .contract existing
        appointments[raidenAppointment.stateUpdate.channel_identifier] = {
            appointment: raidenAppointment,
            listener: listener
        };
    }
}

const wait = (timeout: number) => {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve();
        }, timeout);
    });
};