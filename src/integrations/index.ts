// import { IChannelConfig } from "./config";
// export { IChannelConfig } from "./config";
// import { RaidenAppointment, RaidenInspector } from "./raiden";
// import { ethers } from "ethers";
// import { ChannelType } from "../dataEntities";
// import { KitsuneAppointment, KitsuneInspector } from "./kitsune";

// export const Raiden: IChannelConfig<RaidenAppointment, RaidenInspector> = {
//     channelType: ChannelType.Raiden,
//     appointment: obj => new RaidenAppointment(obj),
//     inspector: (minimumDisputePeriod: number, provider: ethers.providers.Provider) =>
//         new RaidenInspector(minimumDisputePeriod, provider),
//     minimumDisputePeriod: 4
// };

// export const Kitsune: IChannelConfig<KitsuneAppointment, KitsuneInspector> = {
//     channelType: ChannelType.Kitsune,
//     appointment: obj => new KitsuneAppointment(obj),
//     inspector: (minimumDisputePeriod: number, provider: ethers.providers.Provider) =>
//         new KitsuneInspector(minimumDisputePeriod, provider),
//     minimumDisputePeriod: 10
// };
