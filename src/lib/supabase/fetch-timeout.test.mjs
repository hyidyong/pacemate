import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");

// Stage 8 P1-2 failure injection. supabase-js applies no default timeout, so a
// hung PostgREST/GoTrue request pinned the serverless invocation until the
// platform killed it. These tests prove the wrapper bounds a request that never
// resolves, leaves fast requests untouched, and still honours a caller's own
// AbortSignal.

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

function withStubbedFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test("a request that never resolves is aborted rather than hanging forever", async () => {
  const { createTimeoutFetch } = await loadModule();
  const timeoutFetch = createTimeoutFetch(60);

  // Models a hung upstream: resolves only if the signal aborts.
  const hungFetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    });

  await withStubbedFetch(hungFetch, async () => {
    await assert.rejects(
      () => timeoutFetch("https://example.test/rest/v1/counseling_requests"),
      (error) => error?.name === "TimeoutError" || error?.name === "AbortError",
      "a hung Supabase request must abort, not occupy the invocation indefinitely",
    );
  });
});

test("a fast request is unaffected by the timeout", async () => {
  const { createTimeoutFetch } = await loadModule();
  const timeoutFetch = createTimeoutFetch(5000);

  await withStubbedFetch(async () => ({ ok: true, status: 200 }), async () => {
    const response = await timeoutFetch("https://example.test/rest/v1/profiles");
    assert.equal(response.status, 200);
  });
});

test("a caller's own abort signal still propagates", async () => {
  const { createTimeoutFetch } = await loadModule();
  const timeoutFetch = createTimeoutFetch(60000);
  const controller = new AbortController();

  const hungFetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    });

  await withStubbedFetch(hungFetch, async () => {
    const pending = timeoutFetch("https://example.test/rest/v1/profiles", {
      signal: controller.signal,
    });
    controller.abort(new Error("caller cancelled"));
    await assert.rejects(() => pending, /caller cancelled/);
  });
});

test("the configured bound is above the measured p99 and below platform limits", async () => {
  const { SUPABASE_REQUEST_TIMEOUT_MS } = await loadModule();
  assert.ok(
    SUPABASE_REQUEST_TIMEOUT_MS > 1196,
    "must exceed the measured p99 (1196ms at c=10) so legitimate slow requests are not severed",
  );
  assert.ok(
    SUPABASE_REQUEST_TIMEOUT_MS <= 15000,
    "must stay below typical serverless function limits so the app fails before the platform does",
  );
});
