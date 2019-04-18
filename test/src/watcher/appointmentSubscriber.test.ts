import "mocha";
import { assert } from "chai";
import { ethers } from "ethers";
import { AppointmentSubscriber, IAppointmentListener } from "../../../src/watcher/appointmentSubscriber";
import uuid from "uuid/v4";
import Ganache from "ganache-core";

describe("AppointmentSubscriber", () => {
    //return true;
    const eventFilter1 = "eventFilter1";
    const eventFilter2 = "eventFilter2";
    const appointmentId1 = uuid();
    const appointmentId2 = uuid();
    const testListener = () => {
        throw new Error("Should not be fired during subscription / non subscription.");
    };

    let provider: ethers.providers.Web3Provider, subscriber: AppointmentSubscriber;

    beforeEach(() => {
        // new ganache, provider and subscriber
        const ganache = Ganache.provider({});
        provider = new ethers.providers.Web3Provider(ganache);
        subscriber = new AppointmentSubscriber(provider);
    });

    it("subscribeOnce correctly subcribes 1 appointment", () => {
        // once
        subscriber.subscribeOnce(appointmentId1, eventFilter1, testListener);

        //verify
        assert.strictEqual(provider.listenerCount(eventFilter1), 1);
        assert.strictEqual((provider.listeners(eventFilter1)[0] as IAppointmentListener).appointmentId, appointmentId1);
    });

    it("subscribeOnce correctly subcribes 2 different appointments", () => {
        // same ids and listeners, but different filters
        subscriber.subscribeOnce(appointmentId1, eventFilter1, testListener);
        subscriber.subscribeOnce(appointmentId2, eventFilter2, testListener);
        //verify
        assert.strictEqual(provider.listenerCount(eventFilter1), 1);
        assert.strictEqual((provider.listeners(eventFilter1)[0] as IAppointmentListener).appointmentId, appointmentId1);
        assert.strictEqual(provider.listenerCount(eventFilter2), 1);
        assert.strictEqual((provider.listeners(eventFilter2)[0] as IAppointmentListener).appointmentId, appointmentId2);
    });

    it("subscribeOnce throws error if one subscribed to twice for the same event filter", () => {
        subscriber.subscribeOnce(appointmentId1, eventFilter1, testListener);
        assert.throws(() => subscriber.subscribeOnce(appointmentId1, eventFilter1, testListener));

        assert.strictEqual(provider.listenerCount(eventFilter1), 1);
        assert.strictEqual((provider.listeners(eventFilter1)[0] as IAppointmentListener).appointmentId, appointmentId1);
    });

    it("unsubscribe does nothing when neither filter nor id match", () => {
        subscriber.subscribeOnce(appointmentId1, eventFilter1, testListener);
        subscriber.subscribeOnce(appointmentId2, eventFilter2, testListener);

        subscriber.unsubscribe(uuid(), "eventFilter3");

        assert.strictEqual(provider.listenerCount(eventFilter1), 1);
        assert.strictEqual((provider.listeners(eventFilter1)[0] as IAppointmentListener).appointmentId, appointmentId1);
        assert.strictEqual(provider.listenerCount(eventFilter2), 1);
        assert.strictEqual((provider.listeners(eventFilter2)[0] as IAppointmentListener).appointmentId, appointmentId2);
    });

    it("unsubscribe does nothing when when filter does not match but id does", () => {
        subscriber.subscribeOnce(appointmentId1, eventFilter1, testListener);
        subscriber.subscribeOnce(appointmentId2, eventFilter2, testListener);

        subscriber.unsubscribe(appointmentId1, eventFilter2);

        assert.strictEqual(provider.listenerCount(eventFilter1), 1);
        assert.strictEqual((provider.listeners(eventFilter1)[0] as IAppointmentListener).appointmentId, appointmentId1);
        assert.strictEqual(provider.listenerCount(eventFilter2), 1);
        assert.strictEqual((provider.listeners(eventFilter2)[0] as IAppointmentListener).appointmentId, appointmentId2);
    });

    it("unsubscribe does nothing when id matches but filter does not", () => {
        subscriber.subscribeOnce(appointmentId1, eventFilter1, testListener);
        subscriber.subscribeOnce(appointmentId2, eventFilter2, testListener);

        subscriber.unsubscribe(appointmentId2, eventFilter1);

        assert.strictEqual(provider.listenerCount(eventFilter1), 1);
        assert.strictEqual((provider.listeners(eventFilter1)[0] as IAppointmentListener).appointmentId, appointmentId1);
        assert.strictEqual(provider.listenerCount(eventFilter2), 1);
        assert.strictEqual((provider.listeners(eventFilter2)[0] as IAppointmentListener).appointmentId, appointmentId2);
    });

    it("unsubscribe only removes subscription when filter and id match", () => {
        subscriber.subscribeOnce(appointmentId1, eventFilter1, testListener);
        subscriber.subscribeOnce(appointmentId2, eventFilter2, testListener);

        subscriber.unsubscribe(appointmentId1, eventFilter1);

        assert.strictEqual(provider.listenerCount(eventFilter1), 0);
        assert.strictEqual(provider.listenerCount(eventFilter2), 1);
        assert.strictEqual((provider.listeners(eventFilter2)[0] as IAppointmentListener).appointmentId, appointmentId2);
    });

    it("unsubscribeAll does nothing when no filter matches", () => {
        subscriber.subscribeOnce(appointmentId1, eventFilter1, testListener);

        subscriber.unsubscribeAll(eventFilter2);

        assert.strictEqual(provider.listenerCount(eventFilter1), 1);
        assert.strictEqual((provider.listeners(eventFilter1)[0] as IAppointmentListener).appointmentId, appointmentId1);
    });

    it("unsubscribeAll removes all subscriptions that match an event", () => {
        subscriber.subscribeOnce(appointmentId1, eventFilter1, testListener);
        subscriber.subscribeOnce(appointmentId2, eventFilter2, testListener);

        subscriber.unsubscribeAll(eventFilter1);

        assert.strictEqual(provider.listenerCount(eventFilter1), 0);
        assert.strictEqual(provider.listenerCount(eventFilter2), 1);
        assert.strictEqual((provider.listeners(eventFilter2)[0] as IAppointmentListener).appointmentId, appointmentId2);
    });
});
