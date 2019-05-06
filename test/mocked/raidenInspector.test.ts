import mockito from "ts-mockito";
import * as chai from "chai";
import { ethers } from "ethers";
import { RaidenInspector, RaidenAppointment, RaidenTools } from "../../src/integrations/raiden";
import { ChannelType } from "../../src/dataEntities";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;

describe("Raiden inspector", () => {
    let provider: ethers.providers.JsonRpcProvider;
    const minimumDisputePeriod = 10;
    const appointmentObj = {
        expiryPeriod: 10000,
        // cast here to inform the type guard on new RaidenAppointment
        type: ChannelType.Raiden as ChannelType.Raiden,
        stateUpdate: {
            additional_hash: "0xbea4d9b77acbfb279382b573824ec01ebc6b2185ccd0db2d967ba600250bf9f4",
            balance_hash: "0xe73f895f3e0439ede072b30229eac682208f45c1e1d939f2e8d3a71980778765",
            channel_identifier: 1,
            closing_participant: "0xdddEC4D561eE68F37855fa3245Cb878b10Eb1fA0",
            closing_signature:
                "0x078d3465de0781b3011323df87e55491124fecdb74df8ed5857bdedf63f9a242680afc7311d0681b09108c01f3f72b9fcdffd803bced1df1fb944e219588286a1b",
            non_closing_participant: "0xccca21b97b27DefC210f01A7e64119A784424D26",
            non_closing_signature:
                "0xd77e9816a50c897a36dd02380b4789a07adb58f7a9cf91cf8c36447539a6bb6e1d118b035886e317189610dd3cdc8adbaeea4a78e5391876ba606189c1aeadd81b",
            nonce: 2,
            chain_id: 3,
            token_network_identifier: "0x34636d2289588BcA4e0fcF863857386F56b44bdC"
        }
    };

    before(() => {
        const onChainSettleBlockNumber = 500;
        const onChainNonce = 1;
        const onChainStatus = 1;
        const onChainBlockNumber = 200;
        const spiedEthers = mockito.spy(ethers);

        // contract
        const tokenNetworkAddress = "0x34636d2289588BcA4e0fcF863857386F56b44bdC";
        // mock party 1 and party 2 to return 0x and mangled bytecode respectively
        // we're just using them as fummies here
        const party1Address = "0xccca21b97b27DefC210f01A7e64119A784424D26";
        const party2Address = "0xdddEC4D561eE68F37855fa3245Cb878b10Eb1fA0";
        const otherTokenNetwork = "0xf0afbed24d88ce4cb12828984bb10d2f1ad0e185";
        const mockedProvider = mockito.mock(ethers.providers.JsonRpcProvider);
        mockito.when(mockedProvider.getCode(tokenNetworkAddress)).thenResolve(RaidenTools.ContractDeployedBytecode);
        mockito.when(mockedProvider.getCode(otherTokenNetwork)).thenResolve(RaidenTools.ContractDeployedBytecode);
        mockito.when(mockedProvider.getCode(party1Address)).thenResolve("0x");
        mockito
            .when(mockedProvider.getCode(party2Address))
            .thenResolve(
                RaidenTools.ContractDeployedBytecode.slice(0, RaidenTools.ContractDeployedBytecode.length - 20)
            );
        mockito.when(mockedProvider.getBlockNumber()).thenResolve(onChainBlockNumber);
        provider = mockito.instance(mockedProvider);

        const contractMock = mockito.mock(ethers.Contract);
        const getChannelParticipantInfo = () => new Promise(resolve => resolve(["", "", "", "", onChainNonce]));
        const getChannelInfo = () => new Promise(resolve => resolve([onChainSettleBlockNumber, onChainStatus]));
        mockito.when(contractMock.functions).thenReturn({
            getChannelParticipantInfo,
            getChannelInfo
        });
        const contract = mockito.instance(contractMock);

        mockito
            .when(new spiedEthers.Contract(tokenNetworkAddress, RaidenTools.ContractAbi, provider))
            .thenReturn(contract);
    });

    it("accepts appointment", async () => {
        const appointment = new RaidenAppointment(appointmentObj);

        const inspector = new RaidenInspector(minimumDisputePeriod, provider);
        await inspector.checkInspection(appointment);
    });

    it("throws for expiry equal to dispute", async () => {
        const appointment = new RaidenAppointment({ ...appointmentObj, expiryPeriod: 10 });
        const inspector = new RaidenInspector(minimumDisputePeriod, provider);
        expect(inspector.checkInspection(appointment)).eventually.be.rejected;
    });

    it("throws for expiry less than dispute", async () => {
        const appointment = new RaidenAppointment({ ...appointmentObj, expiryPeriod: 9 });
        const inspector = new RaidenInspector(minimumDisputePeriod, provider);
        expect(inspector.checkInspection(appointment)).eventually.be.rejected;
    });

    it("throws for wrong additional hash", async () => {
        // original additional hash: 0xbea4d9b77acbfb279382b573824ec01ebc6b2185ccd0db2d967ba600250bf9f4
        // wrong additional hash: 0xaea4d9b77acbfb279382b573824ec01ebc6b2185ccd0db2d967ba600250bf9f4
        const wrongAdditionalHash = "0xaea4d9b77acbfb279382b573824ec01ebc6b2185ccd0db2d967ba600250bf9f4";
        const appointment = new RaidenAppointment({
            ...appointmentObj,
            stateUpdate: { ...appointmentObj.stateUpdate, additional_hash: wrongAdditionalHash }
        });

        const inspector = new RaidenInspector(minimumDisputePeriod, provider);
        expect(inspector.checkInspection(appointment)).eventually.be.rejected;
    });

    it("throws for wrong balance hash", async () => {
        // balance hash: 0xe73f895f3e0439ede072b30229eac682208f45c1e1d939f2e8d3a71980778765
        // wrong balance hash: 0xe73f895f3e0439ede072b30229eac682208f45c1e1d939f2e8d3a71980778765
        const wrongBalanceHash = "0xa73f895f3e0439ede072b30229eac682208f45c1e1d939f2e8d3a71980778765";
        const appointment = new RaidenAppointment({
            ...appointmentObj,
            stateUpdate: { ...appointmentObj.stateUpdate, balance_hash: wrongBalanceHash }
        });
        const inspector = new RaidenInspector(minimumDisputePeriod, provider);
        expect(inspector.checkInspection(appointment)).eventually.be.rejected;
    });

    it("throws for incorrect channel identifier", async () => {
        const appointment = new RaidenAppointment({
            ...appointmentObj,
            stateUpdate: { ...appointmentObj.stateUpdate, channel_identifier: 2 }
        });

        const inspector = new RaidenInspector(minimumDisputePeriod, provider);
        expect(inspector.checkInspection(appointment)).eventually.be.rejected;
    });

    it("throws for incorrect closing participant", async () => {
        // correct closing participant: 0xdddEC4D561eE68F37855fa3245Cb878b10Eb1fA0
        // use the other party: 0xccca21b97b27DefC210f01A7e64119A784424D26
        const wrongClosingParticipant = "0xccca21b97b27DefC210f01A7e64119A784424D26";
        const appointment = new RaidenAppointment({
            ...appointmentObj,
            stateUpdate: { ...appointmentObj.stateUpdate, closing_participant: wrongClosingParticipant }
        });

        const inspector = new RaidenInspector(minimumDisputePeriod, provider);
        expect(inspector.checkInspection(appointment)).eventually.be.rejected;
    });

    it("throws for wrong closing participant sig", async () => {
        // use sig by non closing party
        const incorrectClosingParticipantSig =
            "0xd77e9816a50c897a36dd02380b4789a07adb58f7a9cf91cf8c36447539a6bb6e1d118b035886e317189610dd3cdc8adbaeea4a78e5391876ba606189c1aeadd81b";
        const appointment = new RaidenAppointment({
            ...appointmentObj,
            stateUpdate: { ...appointmentObj.stateUpdate, closing_signature: incorrectClosingParticipantSig }
        });

        const inspector = new RaidenInspector(minimumDisputePeriod, provider);
        expect(inspector.checkInspection(appointment)).eventually.be.rejected;
    });

    it("throws for incorrect non_closing participant", async () => {
        const wrongNonClosingParticipant = "0xdddEC4D561eE68F37855fa3245Cb878b10Eb1fA0";

        const appointment = new RaidenAppointment({
            ...appointmentObj,
            stateUpdate: { ...appointmentObj.stateUpdate, non_closing_participant: wrongNonClosingParticipant }
        });
        const inspector = new RaidenInspector(minimumDisputePeriod, provider);
        expect(inspector.checkInspection(appointment)).eventually.be.rejected;
    });

    it("throws for wrong non_closing participant sig", async () => {
        // use sig by non closing party
        const incorrectNonClosingParticipantSig =
            "0x078d3465de0781b3011323df87e55491124fecdb74df8ed5857bdedf63f9a242680afc7311d0681b09108c01f3f72b9fcdffd803bced1df1fb944e219588286a1b";

        const appointment = new RaidenAppointment({
            ...appointmentObj,
            stateUpdate: { ...appointmentObj.stateUpdate, non_closing_signature: incorrectNonClosingParticipantSig }
        });

        const inspector = new RaidenInspector(minimumDisputePeriod, provider);
        expect(inspector.checkInspection(appointment)).eventually.be.rejected;
    });

    it("throws for nonce too low", async () => {
        const appointment = new RaidenAppointment({
            ...appointmentObj,
            stateUpdate: { ...appointmentObj.stateUpdate, nonce: 1 }
        });

        const inspector = new RaidenInspector(minimumDisputePeriod, provider);
        expect(inspector.checkInspection(appointment)).eventually.be.rejected;
    });

    it("throws for wrong chain id", async () => {
        const appointment = new RaidenAppointment({
            ...appointmentObj,
            stateUpdate: { ...appointmentObj.stateUpdate, chain_id: 4 }
        });
        const inspector = new RaidenInspector(minimumDisputePeriod, provider);
        expect(inspector.checkInspection(appointment)).eventually.be.rejected;
    });

    it("throws for wrong token network id", async () => {
        const appointment = new RaidenAppointment({
            ...appointmentObj,
            stateUpdate: {
                ...appointmentObj.stateUpdate,
                token_network_identifier: "0xf0afbed24d88ce4cb12828984bb10d2f1ad0e185"
            }
        });
        const inspector = new RaidenInspector(minimumDisputePeriod, provider);
        expect(inspector.checkInspection(appointment)).eventually.be.rejected;
    });

    it("throws for no code returned", async () => {
        const appointment = new RaidenAppointment({
            ...appointmentObj,
            stateUpdate: {
                ...appointmentObj.stateUpdate,
                // we've set up the non closing participant to return 0x
                token_network_identifier: appointmentObj.stateUpdate.non_closing_participant
            }
        });
        const inspector = new RaidenInspector(minimumDisputePeriod, provider);
        expect(inspector.checkInspection(appointment)).eventually.be.rejected;
    });

    it("throws for wrong code returned", async () => {
        const appointment = new RaidenAppointment({
            ...appointmentObj,
            stateUpdate: {
                ...appointmentObj.stateUpdate,
                // we've set up the non closing participant to return a substring of the actual bytecode
                token_network_identifier: appointmentObj.stateUpdate.closing_participant
            }
        });
        const inspector = new RaidenInspector(minimumDisputePeriod, provider);
        expect(inspector.checkInspection(appointment)).eventually.be.rejected;
    });
});
