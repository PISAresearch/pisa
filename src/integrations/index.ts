import { IChannelConfig } from "./config";
export { IChannelConfig } from "./config";
import { RaidenAppointment, RaidenInspector, prepareResponse as prepareRaidenResponse } from "./raiden";
import { ethers } from "ethers";
import { ChannelType } from "../dataEntities";
import { KitsuneAppointment, KitsuneInspector, prepareResponse as prepareKitsuneResponse } from "./kitsune";

export const Raiden: IChannelConfig<RaidenAppointment, RaidenInspector> = {
    channelType: ChannelType.Raiden,
    appointment: obj => new RaidenAppointment(obj),
    inspector: (minimumDisputePeriod: number, provider: ethers.providers.Provider) =>
        new RaidenInspector(minimumDisputePeriod, provider),
    // PISA: currently set to 4 for the demo - should be configurable
    minimumDisputePeriod: 4,
    prepareResponse: prepareRaidenResponse
};

export const Kitsune: IChannelConfig<KitsuneAppointment, KitsuneInspector> = {
    channelType: ChannelType.Kitsune,
    appointment: obj => new KitsuneAppointment(obj),
    inspector: (minimumDisputePeriod: number, provider: ethers.providers.Provider) =>
        new KitsuneInspector(minimumDisputePeriod, provider),
    minimumDisputePeriod: 10,
    prepareResponse: prepareKitsuneResponse
};
