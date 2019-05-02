export { IAppointment, IEthereumAppointment, EthereumAppointment, IEthereumResponseData } from "./appointment";
export { ArgumentError, PublicDataValidationError, PublicInspectionError, ConfigurationError, ApplicationError } from "./errors";
export { ChannelType } from "./channelType";
export {
    checkAppointment,
    propertyExistsAndIsOfType,
    doesPropertyExist,
    isPropertyOfType,
    isArrayOfStrings
} from "./checkAppointment";
export { StartStopService } from "./startStop";
