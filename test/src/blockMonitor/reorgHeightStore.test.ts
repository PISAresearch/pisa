import "mocha"
import { expect } from "chai";
import { ReorgHeightListenerStore } from "../../../src/blockMonitor";

describe("BlockHeightListenerStore", () => {
    const listener0 = {
        height: 0,
        listener: async () => {}
    };
    const listener0a = {
        height: 0,
        listener: async () => {}
    };
    const listener0b = {
        height: 0,
        listener: async () => {}
    };
    const listener1 = {
        height: 1,
        listener: async () => {}
    };
    const listener1a = {
        height: 1,
        listener: async () => {}
    };
    const listener2 = {
        height: 2,
        listener: async () => {}
    };

    it("addListener/removeListener/getHeight does add/remove one listener", () => {
        const store = new ReorgHeightListenerStore();
        store.addListener(listener0);
        expect(store.getListenersFromHeight(0)).to.deep.equal([listener0]);
        expect(store.removeListener(listener0)).to.be.true;
        expect(store.getListenersFromHeight(0)).to.deep.equal([]);
    });
    it("addListener/removeListener/getHeight adds multiple listeners", () => {
        const store = new ReorgHeightListenerStore();
        store.addListener(listener0);
        store.addListener(listener1);
        expect(store.getListenersFromHeight(0)).to.deep.equal([listener0, listener1]);
        expect(store.removeListener(listener0)).to.be.true;
        expect(store.getListenersFromHeight(0)).to.deep.equal([listener1]);
    });
    it("removeListener does nothing for non existant listener", () => {
        const store = new ReorgHeightListenerStore();
        store.addListener(listener0);
        store.addListener(listener1);
        expect(store.getListenersFromHeight(0)).to.deep.equal([listener0, listener1]);
        expect(store.removeListener(listener0)).to.be.true;
        expect(store.getListenersFromHeight(0)).to.deep.equal([listener1]);
        // removing again should do nothing
        expect(store.removeListener(listener0)).to.be.false;
        expect(store.getListenersFromHeight(0)).to.deep.equal([listener1]);
    });
    it("prune deletes all listeners below, but not above", () => {
        const store = new ReorgHeightListenerStore();
        store.addListener(listener0);
        store.addListener(listener0a);
        store.addListener(listener0b);
        store.addListener(listener1);
        store.addListener(listener1a);
        store.addListener(listener2);
        expect(store.getListenersFromHeight(0)).to.deep.equal([
            listener0,
            listener0a,
            listener0b,
            listener1,
            listener1a,
            listener2
        ]);

        store.prune(1);
        expect(store.getListenersFromHeight(0)).to.deep.equal([listener1, listener1a, listener2]);
    });
});
