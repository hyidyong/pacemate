import assert from "node:assert/strict";
import test from "node:test";

import * as realtimeDelivery from "./realtime-delivery.mjs";
import {
  classifyNotificationDelivery,
  createRealtimeInbox,
  waitForRealtimeRow,
} from "./realtime-delivery.mjs";

function createDeliveryFixture() {
  return {
    directId: "direct-a",
    broadcastIds: { a: "broadcast-a", b: "broadcast-b" },
    foreignSentinelId: "foreign-sentinel",
    inboxes: {
      a: { rows: [{ id: "direct-a" }, { id: "broadcast-a" }] },
      b: { rows: [{ id: "broadcast-b" }] },
      foreign: { rows: [{ id: "foreign-sentinel" }] },
    },
  };
}

function createFakeClock(onSleep) {
  let elapsedMs = 0;
  return {
    now: () => elapsedMs,
    sleep: async (ms) => {
      elapsedMs += ms;
      onSleep?.(elapsedMs);
    },
  };
}

test("a Realtime inbox authenticates before subscribing and records INSERT payloads", async () => {
  const order = [];
  let onInsert;
  const channel = {
    on(_kind, filter, callback) {
      order.push(["on", filter]);
      onInsert = callback;
      return this;
    },
    subscribe(callback) {
      order.push(["subscribe"]);
      callback("SUBSCRIBED");
      return this;
    },
  };
  const client = {
    realtime: {
      setAuth(token) {
        order.push(["setAuth", token]);
      },
      disconnect() {
        order.push(["disconnect"]);
      },
    },
    channel(name) {
      order.push(["channel", name]);
      return channel;
    },
    async removeChannel(value) {
      assert.equal(value, channel);
      order.push(["removeChannel"]);
    },
  };

  const inbox = createRealtimeInbox({
    url: "https://stagingref000000.supabase.co",
    anonKey: "anon-test",
    accessToken: "access-test",
    label: "student-a",
    timeoutMs: 50,
    createClientImpl: () => client,
  });
  await inbox.start();
  onInsert({ new: { id: "row-a", recipient_id: "profile-a" } });
  assert.deepEqual(inbox.rows, [{ id: "row-a", recipient_id: "profile-a" }]);
  assert.ok(order.findIndex(([name]) => name === "setAuth") < order.findIndex(([name]) => name === "subscribe"));
  assert.deepEqual(order.find(([name]) => name === "on")[1], {
    event: "INSERT",
    schema: "public",
    table: "user_notifications",
  });
  await inbox.close();
  assert.ok(order.some(([name]) => name === "removeChannel"));
  assert.ok(order.some(([name]) => name === "disconnect"));
});

test("subscription errors fail instead of being reported as delivery evidence", async () => {
  const client = {
    realtime: { setAuth() {}, disconnect() {} },
    channel() {
      return {
        on() { return this; },
        subscribe(callback) {
          callback("CHANNEL_ERROR", new Error("socket refused"));
          return this;
        },
      };
    },
    async removeChannel() {},
  };
  const inbox = createRealtimeInbox({
    url: "https://stagingref000000.supabase.co",
    anonKey: "anon-test",
    accessToken: "access-test",
    label: "student-a",
    timeoutMs: 50,
    createClientImpl: () => client,
  });
  await assert.rejects(inbox.start(), /student-a.*CHANNEL_ERROR/);
});

test("waitForRealtimeRow distinguishes a delivered row from a timeout", async () => {
  const inbox = { rows: [] };
  setTimeout(() => inbox.rows.push({ id: "arrived" }), 5);
  assert.equal(await waitForRealtimeRow(inbox, "arrived", { timeoutMs: 100, pollMs: 2 }), true);
  assert.equal(await waitForRealtimeRow(inbox, "missing", { timeoutMs: 10, pollMs: 2 }), false);
});

test("delivery classification requires both positive paths and rejects peer/cross-tenant leakage", () => {
  const clean = classifyNotificationDelivery({
    directId: "direct-a",
    broadcastIds: { a: "broadcast-a", b: "broadcast-b" },
    foreignSentinelId: "foreign-sentinel",
    inboxes: {
      a: { rows: [{ id: "direct-a" }, { id: "broadcast-a" }] },
      b: { rows: [{ id: "broadcast-b" }] },
      foreign: { rows: [{ id: "foreign-sentinel" }] },
    },
  });
  assert.equal(clean.length, 10);
  assert.deepEqual(clean.map((entry) => [entry.id, entry.pass]), [
    ["realtime:direct-recipient", true],
    ["realtime:direct-peer-isolation", true],
    ["realtime:direct-tenant-isolation", true],
    ["realtime:broadcast-recipient-a", true],
    ["realtime:broadcast-peer-a-isolation", true],
    ["realtime:broadcast-recipient-b", true],
    ["realtime:broadcast-peer-b-isolation", true],
    ["realtime:broadcast-tenant-isolation", true],
    ["realtime:foreign-sentinel-recipient", true],
    ["realtime:foreign-sentinel-tenant-isolation", true],
  ]);

  const leaked = classifyNotificationDelivery({
    directId: "direct-a",
    broadcastIds: { a: "broadcast-a", b: "broadcast-b" },
    foreignSentinelId: "foreign-sentinel",
    inboxes: {
      a: { rows: [{ id: "direct-a" }, { id: "broadcast-a" }] },
      b: { rows: [{ id: "direct-a" }, { id: "broadcast-b" }] },
      foreign: { rows: [{ id: "broadcast-a" }, { id: "foreign-sentinel" }] },
    },
  });
  assert.equal(leaked.find((entry) => entry.id === "realtime:direct-peer-isolation").pass, false);
  assert.equal(leaked.find((entry) => entry.id === "realtime:broadcast-tenant-isolation").pass, false);
});

test("same-tenant all-to-all broadcast delivery fails both peer-isolation checks", () => {
  const verdicts = classifyNotificationDelivery({
    directId: "direct-a",
    broadcastIds: { a: "broadcast-a", b: "broadcast-b" },
    foreignSentinelId: "foreign-sentinel",
    inboxes: {
      a: { rows: [{ id: "direct-a" }, { id: "broadcast-a" }, { id: "broadcast-b" }] },
      b: { rows: [{ id: "broadcast-a" }, { id: "broadcast-b" }] },
      foreign: { rows: [{ id: "foreign-sentinel" }] },
    },
  });

  assert.deepEqual(
    verdicts.filter((entry) => !entry.pass).map((entry) => entry.id),
    ["realtime:broadcast-peer-a-isolation", "realtime:broadcast-peer-b-isolation"],
  );
});

test("a broken foreign observer fails its authorized sentinel check", () => {
  const verdicts = classifyNotificationDelivery({
    directId: "direct-a",
    broadcastIds: { a: "broadcast-a", b: "broadcast-b" },
    foreignSentinelId: "foreign-sentinel",
    inboxes: {
      a: { rows: [{ id: "direct-a" }, { id: "broadcast-a" }] },
      b: { rows: [{ id: "broadcast-b" }] },
      foreign: { rows: [] },
    },
  });

  assert.equal(
    verdicts.find((entry) => entry.id === "realtime:foreign-sentinel-recipient")?.pass,
    false,
  );
});

test("home-tenant observers fail isolation if they receive the foreign sentinel", () => {
  const verdicts = classifyNotificationDelivery({
    directId: "direct-a",
    broadcastIds: { a: "broadcast-a", b: "broadcast-b" },
    foreignSentinelId: "foreign-sentinel",
    inboxes: {
      a: { rows: [{ id: "direct-a" }, { id: "broadcast-a" }, { id: "foreign-sentinel" }] },
      b: { rows: [{ id: "broadcast-b" }] },
      foreign: { rows: [{ id: "foreign-sentinel" }] },
    },
  });

  assert.equal(
    verdicts.find((entry) => entry.id === "realtime:foreign-sentinel-tenant-isolation")?.pass,
    false,
  );
});

test("bounded observation passes only after all authorized sentinels settle without leakage", async () => {
  assert.equal(
    typeof realtimeDelivery.observeNotificationDelivery,
    "function",
    "the harness needs a condition-based observation boundary",
  );
  const clock = createFakeClock();
  const result = await realtimeDelivery.observeNotificationDelivery({
    ...createDeliveryFixture(),
    deliveryTimeoutMs: 40,
    settlementMs: 30,
    pollMs: 10,
    ...clock,
  });

  assert.equal(result.pass, true);
  assert.equal(result.reason, "settled");
  assert.equal(result.verdicts.every((entry) => entry.pass), true);
});

test("a broken foreign observer times out instead of passing vacuously", async () => {
  assert.equal(typeof realtimeDelivery.observeNotificationDelivery, "function");
  const fixture = createDeliveryFixture();
  fixture.inboxes.foreign.rows = [];
  const result = await realtimeDelivery.observeNotificationDelivery({
    ...fixture,
    deliveryTimeoutMs: 40,
    settlementMs: 30,
    pollMs: 10,
    ...createFakeClock(),
  });

  assert.equal(result.pass, false);
  assert.equal(result.reason, "authorized-delivery-timeout");
  assert.deepEqual(result.missingPositiveIds, ["realtime:foreign-sentinel-recipient"]);
});

test("an unauthorized foreign delivery fails immediately", async () => {
  assert.equal(typeof realtimeDelivery.observeNotificationDelivery, "function");
  const fixture = createDeliveryFixture();
  fixture.inboxes.foreign.rows.push({ id: "direct-a" });
  const result = await realtimeDelivery.observeNotificationDelivery({
    ...fixture,
    deliveryTimeoutMs: 40,
    settlementMs: 30,
    pollMs: 10,
    ...createFakeClock(),
  });

  assert.equal(result.pass, false);
  assert.equal(result.reason, "forbidden-delivery");
  assert.deepEqual(result.failingNegativeIds, ["realtime:direct-tenant-isolation"]);
});

test("a delayed unauthorized foreign delivery within settlement cannot pass", async () => {
  assert.equal(typeof realtimeDelivery.observeNotificationDelivery, "function");
  const fixture = createDeliveryFixture();
  const clock = createFakeClock((elapsedMs) => {
    if (elapsedMs === 20) fixture.inboxes.foreign.rows.push({ id: "broadcast-a" });
  });
  const result = await realtimeDelivery.observeNotificationDelivery({
    ...fixture,
    deliveryTimeoutMs: 40,
    settlementMs: 50,
    pollMs: 10,
    ...clock,
  });

  assert.equal(result.pass, false);
  assert.equal(result.reason, "forbidden-delivery");
  assert.deepEqual(result.failingNegativeIds, ["realtime:broadcast-tenant-isolation"]);
});
