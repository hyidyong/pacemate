// Codex round 3, F1 — once-only, signal-aware cleanup.
//
// The subprocess tests drive the real runner, but Node on Windows cannot
// deliver POSIX signals to a child process, so the signal paths there are
// skipped with an explicit reason rather than silently passing. These tests
// cover the same logic deterministically on every platform by injecting a fake
// process emitter and an `onExit` spy.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { EXIT, createProbeLifecycle } from "./probe-lifecycle.mjs";

const quietLogger = { error() {}, log() {} };

function harness({ cleanup, timeoutMs = 5_000 }) {
  const processRef = new EventEmitter();
  const exits = [];
  const lifecycle = createProbeLifecycle({
    cleanup,
    timeoutMs,
    logger: quietLogger,
    onExit: (code) => exits.push(code),
    processRef,
  });
  return { lifecycle, processRef, exits };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test("cleanup runs exactly once on a normal completion", async () => {
  let calls = 0;
  const { lifecycle } = harness({ cleanup: async () => (calls += 1, { ok: true }) });

  const result = await lifecycle.run(async () => "done");

  assert.equal(calls, 1);
  assert.equal(result.value, "done");
  assert.equal(result.bodyError, null);
  assert.deepEqual(result.cleanup, { ok: true });
});

test("cleanup runs exactly once when the body throws, and the error is preserved", async () => {
  let calls = 0;
  const { lifecycle } = harness({ cleanup: async () => (calls += 1, { ok: true }) });

  const result = await lifecycle.run(async () => {
    throw new Error("probe blew up");
  });

  assert.equal(calls, 1);
  assert.match(result.bodyError.message, /probe blew up/);
  assert.equal(result.cleanup.ok, true);
});

test("cleanup failure is reported as failure, not swallowed", async () => {
  const { lifecycle } = harness({ cleanup: async () => ({ ok: false, detail: "residue remains" }) });

  const result = await lifecycle.run(async () => "ok");

  assert.equal(result.cleanup.ok, false);
  assert.match(result.cleanup.detail, /residue remains/);
});

test("a cleanup that throws is a failure, not an unhandled rejection", async () => {
  const { lifecycle } = harness({
    cleanup: async () => {
      throw new Error("delete refused");
    },
  });

  const result = await lifecycle.run(async () => "ok");

  assert.equal(result.cleanup.ok, false);
  assert.match(result.cleanup.detail, /delete refused/);
});

test("a hung cleanup is bounded and reported, rather than hanging the runner", async () => {
  const { lifecycle } = harness({
    cleanup: () => new Promise(() => {}), // never settles
    timeoutMs: 80,
  });

  const result = await lifecycle.run(async () => "ok");

  assert.equal(result.cleanup.ok, false);
  assert.match(result.cleanup.detail, /exceeded 80ms/);
});

for (const [signal, expected] of [
  ["SIGINT", EXIT.sigint],
  ["SIGTERM", EXIT.sigterm],
]) {
  test(`${signal} triggers cleanup once and exits ${expected}`, async () => {
    let calls = 0;
    const { lifecycle, processRef, exits } = harness({
      cleanup: async () => (calls += 1, { ok: true }),
    });

    const running = lifecycle.run(async () => {
      processRef.emit(signal);
      await new Promise((resolve) => setTimeout(resolve, 60));
      return "body finished";
    });
    await running;
    await tick();

    assert.equal(calls, 1, `cleanup ran ${calls} times`);
    assert.deepEqual(exits, [expected]);
    assert.deepEqual(lifecycle.signalsSeen, [signal]);
  });
}

test("a repeated signal does not start a second destructive cleanup pass", async () => {
  let calls = 0;
  const { lifecycle, processRef, exits } = harness({
    cleanup: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { ok: true };
    },
  });

  await lifecycle.run(async () => {
    processRef.emit("SIGINT");
    processRef.emit("SIGINT");
    processRef.emit("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
  await tick();

  assert.equal(calls, 1, `cleanup ran ${calls} times for 3 signals`);
  assert.deepEqual(lifecycle.signalsSeen, ["SIGINT", "SIGINT", "SIGTERM"]);
  // Every signal still resolves to an exit, and none of them reports success.
  assert.ok(exits.length >= 1);
  assert.ok(exits.every((code) => code !== EXIT.ok));
});

test("a signal during a FAILING cleanup exits non-zero, not with the signal code", async () => {
  const { lifecycle, processRef, exits } = harness({
    cleanup: async () => ({ ok: false, detail: "could not delete" }),
  });

  await lifecycle.run(async () => {
    processRef.emit("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  await tick();

  assert.deepEqual(exits, [EXIT.failure]);
});

test("signal listeners are removed when the run finishes", async () => {
  const { lifecycle, processRef } = harness({ cleanup: async () => ({ ok: true }) });

  assert.equal(processRef.listenerCount("SIGINT"), 0);
  const running = lifecycle.run(async () => {
    assert.equal(processRef.listenerCount("SIGINT"), 1);
    assert.equal(processRef.listenerCount("SIGTERM"), 1);
    return "ok";
  });
  await running;

  assert.equal(processRef.listenerCount("SIGINT"), 0, "SIGINT listener leaked");
  assert.equal(processRef.listenerCount("SIGTERM"), 0, "SIGTERM listener leaked");
});
