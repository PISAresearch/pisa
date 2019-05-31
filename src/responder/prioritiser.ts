import { IEthereumResponseData } from "../dataEntities";

class TransactionPrioritiser {
    public constructor(blockProcessor: any) {
        const face : 

    }


    public priortise(responseData: IEthereumResponseData) {
        // prioritse by end block

        // get current head block



    }
}

// TODO: 174: document
export interface IPrioritsedEthereumResponseData extends IEthereumResponseData {
    priority: number;
}
