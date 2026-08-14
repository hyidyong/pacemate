// Codex round 4, 4A/4B/4C — the probe transport's three trust properties.
//
// These use an injected `fetchImpl`, so they exercise the real transport with
// no network and no timing luck.

import assert from "node:assert/strict";
import test from "node:test";

import { boundedRequest, createAbortScope, ProbeRequestError } from "./probe-http.mjs";

const never = () => new Promise(() => {});

test("4B — the deadline covers the BODY read, not just the response headers", async () => {
  // Headers arrive immediately; the body never does. This is the shape that
  // used to hang a probe indefinitely, because the timer was cleared as soon as
  // fetch() resolved.
  const headersThenStall = async () => ({
    status: 200,
    headers: new Headers(),
    text: never,
  });

  const started = Date.now();
  await assert.rejects(
    () => boundedRequest("https://probe.test/x", {}, { timeoutMs: 200, fetchImpl: headersThenStall }),
    (error) => {
      assert.ok(error instanceof ProbeRequestError);
      assert.equal(error.timedOut, true, "a stalled body must time out");
      return true;
    },
  );
  assert.ok(Date.now() - started < 5_000, "the stalled body must not hold the deadline open");
});

test("4B — parsing happens inside the deadline: the caller never receives a live stream", async () => {
  const fetchImpl = async () => ({
    status: 200,
    headers: new Headers(),
    text: async () => '{"ok":true}',
  });
  const result = await boundedRequest("https://probe.test/x", {}, { timeoutMs: 500, fetchImpl });
  assert.equal(typeof result.text, "string", "the body is already consumed");
  assert.equal(result.status, 200);
});

test("4C — a MUTATING request that never returns is ambiguous, not failed", async () => {
  // The server may have committed. "It failed" and "I do not know" are
  // different answers and only one of them means nothing was created.
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    await assert.rejects(
      () => boundedRequest("https://probe.test/x", { method }, { timeoutMs: 100, fetchImpl: never }),
      (error) => {
        assert.equal(error.ambiguous, true, `${method} timeout must be reported as ambiguous`);
        return true;
      },
    );
  }
});

test("4C — a READ that never returns is NOT ambiguous: it created nothing", async () => {
  await assert.rejects(
    () => boundedRequest("https://probe.test/x", { method: "GET" }, { timeoutMs: 100, fetchImpl: never }),
    (error) => {
      assert.equal(error.ambiguous, false);
      return true;
    },
  );
});

test("4C — a transport FAILURE on a mutating verb is ambiguous too", async () => {
  // Connection reset after the request was written: the server may well have
  // processed it.
  const reset = async () => {
    throw new Error("ECONNRESET");
  };
  await assert.rejects(
    () => boundedRequest("https://probe.test/x", { method: "POST" }, { timeoutMs: 500, fetchImpl: reset }),
    (error) => {
      assert.equal(error.timedOut, false);
      assert.equal(error.ambiguous, true);
      return true;
    },
  );
});

test("4A — cancelling the shared scope releases an in-flight request immediately", async () => {
  const scope = createAbortScope();
  const abortable = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    });

  const inflight = boundedRequest(
    "https://probe.test/x",
    {},
    { timeoutMs: 60_000, fetchImpl: abortable, scopeSignal: scope.signal },
  );
  const started = Date.now();
  scope.abort("SIGINT");

  await assert.rejects(() => inflight);
  assert.ok(
    Date.now() - started < 5_000,
    "the request must not wait for its own 60s deadline once the scope is cancelled",
  );
});

test("4A — a request started AFTER the scope is cancelled fails at once", async () => {
  const scope = createAbortScope();
  scope.abort("SIGTERM");
  assert.equal(scope.aborted, true);

  const abortable = (_url, init) =>
    new Promise((_resolve, reject) => {
      if (init.signal.aborted) reject(init.signal.reason);
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    });

  await assert.rejects(
    () => boundedRequest("https://probe.test/x", {}, { timeoutMs: 60_000, fetchImpl: abortable, scopeSignal: scope.signal }),
  );
});

test("4A — the scope is idempotent, so a second signal does not throw", () => {
  const scope = createAbortScope();
  scope.abort("SIGINT");
  scope.abort("SIGTERM");
  assert.equal(scope.aborted, true);
});

test("4A — an uncancelled scope does not interfere with a normal request", async () => {
  const scope = createAbortScope();
  const fetchImpl = async () => ({ status: 204, headers: new Headers(), text: async () => "" });
  const result = await boundedRequest(
    "https://probe.test/x",
    {},
    { timeoutMs: 500, fetchImpl, scopeSignal: scope.signal },
  );
  assert.equal(result.status, 204);
  assert.equal(scope.aborted, false);
});
