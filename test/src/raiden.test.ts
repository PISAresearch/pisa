//import * as chai from "chai";
import "mocha";

// TODO: using require is broken with js tests - why do we test with js mocha? because of production issues? if so we NEED to copy the valid json files into the build dir
const RaidenContracts = require("../../../raiden/raiden_contracts/data/contracts.json");
const tokenNetworkAbi = RaidenContracts.contracts.TokenNetwork.abi;

// import { KitsuneInspector } from "../../src/inspector";
// import { KitsuneTools } from "../../src/kitsuneTools";
import { ethers } from "ethers";
let provider = new ethers.providers.JsonRpcProvider("https://ropsten.infura.io/v3/268eda053b8a44cb846ff997fb879282");

// import Ganache from "ganache-core";
// const ganache = Ganache.provider({
//     mnemonic: "myth like bonus scare over problem client lizard pioneer submit female collect"
// });
// const provider: ethers.providers.Web3Provider = new ethers.providers.Web3Provider(ganache);
// const expect = chai.expect;

// const isRejected = async (result: Promise<any>) => {
//     return await result.then(
//         () => {
//             chai.assert.fail();
//         },
//         reject => {
//             expect(reject).to.exist;
//         }
//     );
// };

describe("Raiden tests", () => {
    it("can get channel info", async () => {
        const raidenTokenNetwork = new ethers.Contract(
            "0xa1DE2cD74eFE0EDa3989aa6C1fa3B632927770A8",
            tokenNetworkAbi,
            provider
        );

        const party1 = "0x00f90c078bc4669e0401c606d724cdbef7bd8e6c";
        const party2 = "0xbc682a384c48d3bbf6e25cb10f448f73601b6259";

        const channelIdentfier = await raidenTokenNetwork.getChannelIdentifier(party1, party2);
        let channel = await raidenTokenNetwork.getChannelParticipantInfo(channelIdentfier, party1, party2);
        
        console.log(channel);
    }).timeout(3000);
});

// describe("Inspector", () => {
//     let account0: string, account1: string, channelContract: ethers.Contract, hashState: string, disputePeriod: number;

//     before(async () => {
//         // accounts
//         const accounts = await provider.listAccounts();
//         account0 = accounts[0];
//         account1 = accounts[1];

//         // set the dispute period
//         disputePeriod = 11;

//         // contract
//         const channelContractFactory = new ethers.ContractFactory(

//             KitsuneTools.ContractAbi,

//             KitsuneTools.ContractBytecode,
//             provider.getSigner()
//         );
//         channelContract = await channelContractFactory.deploy([account0, account1], disputePeriod);
//         hashState = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("face-off"));
//     });

//     it("accepts appointment", async () => {

//         // const round = 1,
//         //     setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address),
//         //     sig0 = await provider.getSigner(account0).signMessage(ethers.utils.arrayify(setStateHash)),
//         //     sig1 = await provider.getSigner(account1).signMessage(ethers.utils.arrayify(setStateHash)),
//         //     expiryPeriod = disputePeriod + 1;

//         // const inspector = new KitsuneInspector(10, provider);

//         // await inspector.inspect({
//         //     expiryPeriod,
//         //     stateUpdate: {
//         //         contractAddress: channelContract.address,
//         //         hashState,
//         //         round,
//         //         signatures: [sig0, sig1]
//         //     }
//         // });

//     });
// });
