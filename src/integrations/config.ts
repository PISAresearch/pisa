import { ChannelType, EthereumAppointment, IEthereumResponse } from "../dataEntities";
import { Inspector } from "../inspector";
import { ethers } from "ethers";

export interface IChannelConfig<T1 extends EthereumAppointment, T2 extends Inspector<T1>> {
    appointment: (obj: any) => T1;
    channelType: ChannelType;
    inspector: (minimumDisputePeriod: number, provider: ethers.providers.Provider) => T2;
    minimumDisputePeriod: number;
    prepareResponse: (appointment: T1) => IEthereumResponse
}
