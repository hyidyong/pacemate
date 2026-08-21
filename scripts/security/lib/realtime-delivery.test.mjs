import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyNotificationDelivery,
  createRealtimeInbox,
  waitForRealtimeRow,
} from "./realtime-delivery.mjs";

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
    inboxes: {
      a: { rows: [{ id: "direct-a" }, { id: "broadcast-a" }] },
      b: { rows: [{ id: "broadcast-b" }] },
      foreign: { rows: [] },
    },
  });
  assert.equal(clean.length, 6);
  assert.deepEqual(clean.map((entry) => [entry.id, entry.pass]), [
    ["realtime:direct-recipient", true],
    ["realtime:direct-peer-isolation", true],
    ["realtime:direct-tenant-isolation", true],
    ["realtime:broadcast-recipient-a", true],
    ["realtime:broadcast-recipient-b", true],
    ["realtime:broadcast-tenant-isolation", true],
  ]);

  const leaked = classifyNotificationDelivery({
    directId: "direct-a",
    broadcastIds: { a: "broadcast-a", b: "broadcast-b" },
    inboxes: {
      a: { rows: [{ id: "direct-a" }, { id: "broadcast-a" }] },
      b: { rows: [{ id: "direct-a" }, { id: "broadcast-b" }] },
      foreign: { rows: [{ id: "broadcast-a" }] },
    },
  });
  assert.equal(leaked.find((entry) => entry.id === "realtime:direct-peer-isolation").pass, false);
  assert.equal(leaked.find((entry) => entry.id === "realtime:broadcast-tenant-isolation").pass, false);
});
