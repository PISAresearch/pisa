import "mocha";
import { assert } from "chai";
import { StartStopService } from "../../../src/dataEntities";
import { verify, spy } from "ts-mockito";

class TestStartStop extends StartStopService {
    constructor() {
        super("TEST SERVICE");
    }
    public startInternal() {}
    public stopInternal() {}
}

describe("StartStop", () => {
    it("start can only be called once", async () => {
        const testService = new TestStartStop();
        const spiedService = spy(testService);

        // start twice
        await testService.start();
        try {
            await testService.start();
            assert.fail();
        } catch (err) {}

        await testService.stop();

        //the block event was only subscribed to once
        verify(spiedService.startInternal()).once();
        verify(spiedService.stopInternal()).once();
    });

    it("multiple calls to stop do nothing", async () => {
        const testService = new TestStartStop();
        const spiedService = spy(testService);

        await testService.start();

        // stop twice
        await testService.stop();
        await testService.stop();

        //the block event was only subscribed to once
        verify(spiedService.startInternal()).once();
        verify(spiedService.stopInternal()).once();
    });
});
