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
    beforeEach(() => {
        this.clock = lolex.install({ shouldAdvanceTime: true});
        this.ganache = Ganache.provider({});
        this.provider = new ethers.providers.Web3Provider(this.ganache);
        this.provider.pollingInterval = 20;
    });

    afterEach(() => {
        this.clock.uninstall();
    });

    it("does not reject before the timeout", async () => {
        let promiseResolved = false;
        let promiseThrew = false;

        const p = rejectIfAnyBlockTimesOut(this.provider, Date.now(), 10000, 20)
            .then(() => { promiseResolved = true; })
            .catch(() => { promiseThrew = true; });

        this.clock.tick(9999);
        await Promise.resolve();

        expect(promiseResolved, "did not resolve").to.be.false;
        expect(promiseThrew, "did not throw before the timeout").to.be.false;
    });

    it("rejects after the timeout if no blocks are mined", async () => {
        let promiseResolved = false;
        let promiseThrew = false;

        const p = rejectIfAnyBlockTimesOut(this.provider, Date.now(), 10000, 20)
            .then(() => { promiseResolved = true; })
            .catch(() => { promiseThrew = true; });

        this.clock.tick(10000 + 20 + 1); // Add a delay for the polling interval

        await Promise.resolve();

        expect(promiseResolved, "did not resolve").to.be.false;
        expect(promiseThrew).to.be.true;
    });

    it("does not reject if multiple blocks are mined before the timeout", async () => {
        let promiseResolved = false;
        let promiseThrew = false;

        const p = rejectIfAnyBlockTimesOut(this.provider, Date.now(), 10000, 20)
            .then(() => { promiseResolved = true; })
            .catch(() => { promiseThrew = true; });

        // Fake timers seem to break block creation, so we fake a "new block" event every 9000 ms
        let blockNumber = await this.provider.getBlockNumber();
        const intervalHandle = this.clock.setInterval(async () => {
            blockNumber++;
            this.provider.emit("block", blockNumber);
        }, 9000);

        // Wait 10 times the timeout period, in 100 ms steps
        for (let i = 0; i < 10 * 10000 / 100; i++) {
            this.clock.tick(100);
            await Promise.resolve();
        }

        this.clock.clearInterval(intervalHandle);

        expect(promiseResolved, "did not resolve").to.be.false;
        expect(promiseThrew).to.be.false;
    });

    it("rejects after a timeout after a block is mined", async () => {
        let promiseResolved = false;
        let promiseThrew = false;

        const p = rejectIfAnyBlockTimesOut(this.provider, Date.now(), 10000, 20)
            .then(() => { promiseResolved = true; })
            .catch(() => { promiseThrew = true; });

        this.clock.tick(10000 + 20 + 1); // Add a delay for the polling interval

        await Promise.resolve();

        expect(promiseResolved, "did not resolve").to.be.false;
        expect(promiseThrew).to.be.true;
    });


    it("rejects after a timeout after a few blocks are mined", async () => {
        let promiseResolved = false;
        let promiseThrew = false;

        const p = rejectIfAnyBlockTimesOut(this.provider, Date.now(), 10000, 20)
            .then(() => { promiseResolved = true; })
            .catch(() => { promiseThrew = true; });

        // Fake timers seem to break block creation, so we fake a "new block" event every 9000 ms
        let blockNumber = await this.provider.getBlockNumber();
        const intervalHandle = this.clock.setInterval(async () => {
            blockNumber++;
            this.provider.emit("block", blockNumber);
        }, 9000);

        // Wait 10 times the timeout period, in 100 ms steps
        for (let i = 0; i < 10 * 10000 / 100; i++) {
            this.clock.tick(100);
            await Promise.resolve();
        }

        this.clock.clearInterval(intervalHandle);

        // Now wait longer than the timeout
        this.clock.tick(11000);
        await Promise.resolve();

        expect(promiseResolved, "did not resolve").to.be.false;
        expect(promiseThrew).to.be.true;
    });
});


describe("rejectAfterBlocks", async () => {
    let ganache, provider: ethers.providers.Web3Provider;
    let initialBlockNumber: number;
    const nBlocks = 3;

    beforeEach( async () => {
        ganache = Ganache.provider({});
        provider = new ethers.providers.Web3Provider(ganache);
        provider.pollingInterval = 20;
        initialBlockNumber = await provider.getBlockNumber();
    });

    it("does not reject when less than nBlocks blocks are mined", async () => {
        let promiseResolved = false;
        let promiseThrew = false;

        const p = rejectAfterBlocks(provider, initialBlockNumber, nBlocks)
            .then(() => { promiseResolved = true; })
            .catch(() => { promiseThrew = true; });

        // Mine less than nBlocks blocks
        for (let i = 0; i < nBlocks - 1; i++) {
            await mineBlock(provider);
            await wait(30); // wait longer than the polling period
        }
        expect(promiseResolved, "did not resolve").to.be.false;
        expect(promiseThrew).to.be.false;
    });

    it("rejects if nBlocks blocks are mined", async () => {
        let promiseResolved = false;
        let promiseThrew = false;

        // Mine nBlocks blocks
        const p = rejectAfterBlocks(provider, initialBlockNumber, nBlocks)
            .then(() => { promiseResolved = true; })
            .catch(() => { promiseThrew = true; });

        for (let i = 0; i < nBlocks; i++) {
            await mineBlock(provider);
            await wait(30); // wait longer than the polling period
        }

        expect(promiseResolved, "did not resolve").to.be.false;
        expect(promiseThrew).to.be.true;
    });
});