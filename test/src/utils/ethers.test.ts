import "mocha";
import { expect, assert } from "chai";
import lolex from "lolex";

import { ethers } from "ethers";
import { withDelay, rejectIfAnyBlockTimesOut, rejectAfterBlocks } from "../../../src/utils/ethers";
import Ganache from "ganache-core";
import { wait } from "../../../src/utils";
import { KitsuneTools, KitsuneAppointment } from "../../../src/integrations/kitsune";
import { ChannelType } from "../../../src/dataEntities";


const sendTo = async (provider: ethers.providers.Web3Provider, to: string, value: number) => {
    const tx = await provider.getSigner(0).sendTransaction({ to, value });
    await tx.wait();
};

 const mineBlock = async (provider: ethers.providers.Web3Provider) => {
    await sendTo(provider, "0x0000000000000000000000000000000000000000", 1);
};

 describe("withDelay", () => {
    it("correctly delays getblock", async () => {
        const ganache = Ganache.provider({});
        const provider = new ethers.providers.Web3Provider(ganache);
        provider.pollingInterval = 20;

         // new blockchain
        let expectedBlock = 0;
        expect(await provider.getBlockNumber()).to.equal(expectedBlock);

         // mine 3 blocks
        await mineBlock(provider);
        await mineBlock(provider);
        await mineBlock(provider);
        expectedBlock += 3;

         expect(await provider.getBlockNumber()).to.equal(expectedBlock);

         // set a delay of 2
        withDelay(provider, 2);
        expectedBlock -= 2;

         expect(await provider.getBlockNumber()).to.equal(expectedBlock);
    });

     it("only emits event after delay", async () => {
        const ganache = Ganache.provider({});

         const provider = new ethers.providers.Web3Provider(ganache);
        provider.pollingInterval = 20;
        await mineBlock(provider);
        await mineBlock(provider);
        await mineBlock(provider);
        withDelay(provider, 2);
        expect(await provider.getBlockNumber()).to.equal(1);

         // setup a kitsune contract and trigger a dispute
        const accounts = await provider.listAccounts();
        const player0 = accounts[0];
        const player1 = accounts[1];
        const channelContractFactory = new ethers.ContractFactory(
            KitsuneTools.ContractAbi,
            KitsuneTools.ContractBytecode,
            provider.getSigner(accounts[3])
        );
        const channelContract = await channelContractFactory.deploy([player0, player1], 11);
        const round = 1;
        const hashState = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("hello"));
        const setStateHash = KitsuneTools.hashForSetState(hashState, round, channelContract.address);
        const sig0 = await provider.getSigner(player0).signMessage(ethers.utils.arrayify(setStateHash));
        const sig1 = await provider.getSigner(player1).signMessage(ethers.utils.arrayify(setStateHash));

         // watch for a dispute
        const appointment = new KitsuneAppointment({
            stateUpdate: {
                contractAddress: channelContract.address,
                hashState: hashState,
                round: 1,
                signatures: [sig0, sig1]
            },
            expiryPeriod: 12,
            type: ChannelType.Kitsune
        });

         // add the listener
        const filter = appointment.getEventFilter();
        let error = true;
        provider.once(filter, () => {
            assert.isFalse(error, "Listener fired before error was set to true.");
        });

         const player0Contract = channelContract.connect(provider.getSigner(player0));
        const tx = await player0Contract.triggerDispute();
        await tx.wait();

         await mineBlock(provider);
        // wait longer than the polling interval, then set error to false and mine
        await wait(40);
        error = false;
        await mineBlock(provider);
    });
});



describe("rejectIfAnyBlockTimesOut", async () => {
    it("rejects if no new block is mined for long enough, but not before the timeout", async () => {
        const clock = lolex.install();
        const ganache = Ganache.provider({});
        const provider = new ethers.providers.Web3Provider(ganache);

        let promiseResolved = false;
        let promiseThrew = false;
        const p = rejectIfAnyBlockTimesOut(provider, Date.now(), 10000, 20)
            .then(() => { promiseResolved = true; })
            .catch(() => { promiseThrew = true; });

        clock.tick(9999);
        await Promise.resolve();

        expect(promiseThrew, "did not throw before the timeout").to.be.false;

        clock.tick(2 + 20); // go past timeout + polling interval
        await Promise.resolve();
        await p;

        expect(promiseResolved, "did not resolve").to.be.false;
        expect(promiseThrew, "threw after the timeout").to.be.true;

        clock.uninstall();
    });
});


describe("rejectAfterBlocks", async () => {
    it("rejects if enough blocks are mined, but not before", async () => {
        const ganache = Ganache.provider({});
        const provider = new ethers.providers.Web3Provider(ganache);
        provider.pollingInterval = 20;

        let promiseResolved = false;
        let promiseThrew = false;
        const initialBlockNumber = await provider.getBlockNumber();
        const nBlocks = 3;

        const p = rejectAfterBlocks(provider, initialBlockNumber, nBlocks)
            .then(() => { promiseResolved = true; })
            .catch(() => { promiseThrew = true; });

        for (let i = 0; i < nBlocks - 1; i++) {
            await mineBlock(provider);
            await wait(40); // wait longer than the polling period
        }

        expect(promiseThrew, "did not throw before enough blocks were mined").to.be.false;

        // Mine one more block
        await mineBlock(provider);
        await wait(40); // wait longer than the polling period

        expect(promiseResolved, "did not resolve").to.be.false;
        expect(promiseThrew, "threw after enough blocks were mined").to.be.true;
    });
});