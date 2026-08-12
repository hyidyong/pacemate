import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import test from "node:test";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");
const { createClient } = require("@supabase/supabase-js");

// Stage 8 review finding 1 — SDK-LEVEL bound, not per-attempt bound.
//
// The original wrapper created a fresh AbortSignal.timeout PER FETCH CALL, and
// the installed SDKs retry:
//
//   postgrest-js 2.110.1: retryEnabled defaults to TRUE, DEFAULT_MAX_RETRIES=3,
//     backoff 1s/2s/4s. Its abort check is
//       `fetchError.name === "AbortError" || fetchError.code === "ABORT_ERR"`
//     but AbortSignal.timeout() rejects with name "TimeoutError" (code 23), so
//     the timeout was NOT recognised as an abort and was retried as a network
//     error on GET/HEAD/OPTIONS.
//   auth-js 2.110.1: _refreshAccessToken wraps attempts in retryable() with
//     exponential backoff bounded by AUTO_REFRESH_TICK_DURATION_MS (30s).
//
// So one hung GET became FOUR requests taking ~47s against a 10s documented
// bound — amplifying load on an already-struggling database.
//
// These tests assert the two properties that matter operationally: total
// ELAPSED time is bounded, and the underlying CALL COUNT is not amplified.

function toDataUrl(code) {
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}

let modulePromise;
function loadModule() {
  modulePromise ??= (async () => {
    const source = await readFile(new URL("./fetch-timeout.ts", import.meta.url), "utf8");
    const compiled = transpileModule(source, {
      compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
    }).outputText;
    return import(toDataUrl(compiled));
  })();
  return modulePromise;
}

// A server that accepts the connection and never responds — the real-world
// "hung upstream" this bound exists for.
async function withHangingServer(run) {
  const server = http.createServer(() => {});
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

const BUDGET_MS = 300;

test("a hung PostgREST GET is bounded in total elapsed time, not per attempt", async () => {
  const { createTimeoutFetch } = await loadModule();

  await withHangingServer(async (baseUrl) => {
    let calls = 0;
    const timeoutFetch = createTimeoutFetch(BUDGET_MS);
    const countingFetch = (input, init) => {
      calls += 1;
      return timeoutFetch(input, init);
    };

    const supabase = createClient(baseUrl, "test-anon-key", {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: countingFetch },
    });

    const started = performance.now();
    const { error } = await supabase.from("counseling_requests").select("id");
    const elapsed = performance.now() - started;

    assert.ok(error, "a hung upstream must surface an error, not hang");

    // The SDK must not turn one hung request into a retry storm against a
    // database that is already struggling.
    assert.equal(
      calls,
      1,
      `expected exactly 1 underlying fetch, got ${calls} — the timeout is being retried as a network error`,
    );

    // Total elapsed must stay near the budget, not budget x attempts + backoff.
    assert.ok(
      elapsed < BUDGET_MS * 3,
      `expected total elapsed under ${BUDGET_MS * 3}ms, got ${Math.round(elapsed)}ms`,
    );
  });
});

test("consecutive retries by an SDK share one deadline instead of each getting a fresh one", async () => {
  const { createTimeoutFetch } = await loadModule();

  await withHangingServer(async (baseUrl) => {
    const timeoutFetch = createTimeoutFetch(BUDGET_MS);
    const url = `${baseUrl}/auth/v1/token`;

    const started = performance.now();
    // Model an SDK retry chain: back-to-back attempts at the same endpoint,
    // exactly what auth-js's retryable() does on a failing refresh.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await timeoutFetch(url, { method: "POST" }).catch(() => undefined);
    }
    const elapsed = performance.now() - started;

    assert.ok(
      elapsed < BUDGET_MS * 3,
      `a 4-attempt retry chain must share the deadline; expected under ${BUDGET_MS * 3}ms, got ${Math.round(elapsed)}ms`,
    );
  });
});

test("an independent request after the burst still gets a full budget", async () => {
  const { createTimeoutFetch } = await loadModule();

  await withHangingServer(async (baseUrl) => {
    const timeoutFetch = createTimeoutFetch(BUDGET_MS);
    const url = `${baseUrl}/rest/v1/profiles`;

    await timeoutFetch(url).catch(() => undefined);
    // Once the burst window has passed, a genuinely new request must not be
    // permanently short-circuited — the bound is backpressure, not a kill switch.
    await new Promise((resolve) => setTimeout(resolve, BUDGET_MS * 2 + 50));

    const started = performance.now();
    await timeoutFetch(url).catch(() => undefined);
    const elapsed = performance.now() - started;

    assert.ok(
      elapsed > BUDGET_MS * 0.5,
      `a later independent request should get a real budget, but was cut off after ${Math.round(elapsed)}ms`,
    );
  });
});

test("the abort reason is one the SDKs recognise as an abort", async () => {
  const { createTimeoutFetch } = await loadModule();

  await withHangingServer(async (baseUrl) => {
    const timeoutFetch = createTimeoutFetch(BUDGET_MS);
    const error = await timeoutFetch(`${baseUrl}/rest/v1/x`).then(
      () => null,
      (err) => err,
    );

    assert.ok(error, "expected a rejection");
    // postgrest-js checks name === "AbortError" (or code === "ABORT_ERR") to
    // decide NOT to retry. A "TimeoutError" slips past that check.
    assert.equal(
      error.name,
      "AbortError",
      `abort reason must be AbortError so the SDK stops retrying, got ${error.name}`,
    );
  });
});
