import "mocha";
import { expect } from "chai";
import { StartStopService } from "../../../src/dataEntities";
import { verify, spy } from "ts-mockito";

class TestStartStop extends StartStopService {
    constructor() {
        super("TEST SERVICE");
    }
    public startInternal(){}
    public stopInternal(){}
}


describe("StartStop", () => {
    it("start can only be called once", () => {
        const testService = new TestStartStop();
        const spiedService = spy(testService)
        
        // start twice        
        testService.start();
        expect(() => testService.start()).to.throw();

        testService.stop();

        //the block event was only subscribed to once
        verify(spiedService.startInternal()).once();
        verify(spiedService.stopInternal()).once();
    });

    it("multiple calls to stop do nothing", () => {
        const testService = new TestStartStop();
        const spiedService = spy(testService)

        testService.start()
        
        // stop twice
        testService.stop();
        testService.stop();

        //the block event was only subscribed to once
        verify(spiedService.startInternal()).once();
        verify(spiedService.stopInternal()).once();
    });
})