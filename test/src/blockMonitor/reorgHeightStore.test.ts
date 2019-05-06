import "mocha";
import { expect } from "chai";
import { ReorgHeightListenerStore } from "../../../src/blockMonitor";

describe("ReorgHeightListenerStore", () => {
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
        store.addListener(listener0.height, listener0.listener);
        expect(store.getListenersFromHeight(0)).to.deep.equal([listener0.listener]);
        expect(store.removeListener(listener0.height, listener0.listener)).to.be.true;
        expect(store.getListenersFromHeight(0)).to.deep.equal([]);
    });
    it("addListener/removeListener/getHeight adds multiple listeners", () => {
        const store = new ReorgHeightListenerStore();
        store.addListener(listener0.height, listener0.listener);
        store.addListener(listener1.height, listener1.listener);
        expect(store.getListenersFromHeight(0)).to.deep.equal([listener0.listener, listener1.listener]);
        expect(store.removeListener(listener0.height, listener0.listener)).to.be.true;
        expect(store.getListenersFromHeight(0)).to.deep.equal([listener1.listener]);
    });
    it("removeListener does nothing for non existant listener", () => {
        const store = new ReorgHeightListenerStore();
        store.addListener(listener0.height, listener0.listener);
        store.addListener(listener1.height, listener1.listener);
        expect(store.getListenersFromHeight(0)).to.deep.equal([listener0.listener, listener1.listener]);
        expect(store.removeListener(listener0.height, listener0.listener)).to.be.true;
        expect(store.getListenersFromHeight(0)).to.deep.equal([listener1.listener]);
        // removing again should do nothing
        expect(store.removeListener(listener0.height, listener0.listener)).to.be.false;
        expect(store.getListenersFromHeight(0)).to.deep.equal([listener1.listener]);
    });
    it("prune deletes all listeners below, but not above", () => {
        const store = new ReorgHeightListenerStore();
        store.addListener(listener0.height, listener0.listener);
        store.addListener(listener0a.height, listener0a.listener);
        store.addListener(listener0b.height, listener0b.listener);
        store.addListener(listener1.height, listener1.listener);
        store.addListener(listener1a.height, listener1a.listener);
        store.addListener(listener2.height, listener2.listener);
        expect(store.getListenersFromHeight(0)).to.deep.equal([
            listener0.listener,
            listener0a.listener,
            listener0b.listener,
            listener1.listener,
            listener1a.listener,
            listener2.listener
        ]);

        store.prune(1);
        expect(store.getListenersFromHeight(0)).to.deep.equal([
            listener1.listener,
            listener1a.listener,
            listener2.listener
        ]);
    });
});
