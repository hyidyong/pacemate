// Codex round 5, F5/F6/F7 — the three ways a probe run can lie about cleanup.
//
//   F5  The wrapper settling is not the operation ending. `Promise.race`
//       rejects the caller while the underlying fetch is still open, so cleanup
//       could run and the process exit before a create committed.
//   F6  Ownership was a fixed string shared by every run, matched by SUBSTRING.
//       Unrelated real data containing that phrase was deletable by a sweep
//       that never created it.
//   F7  teardown() computed a sweep result the runner then discarded, so a
//       `[SWEEP FAILED]` run could still exit 0.

import assert from "node:assert/strict";
import test from "node:test";

import { boundedRequest, createAbortScope } from "./probe-http.mjs";
import { PROBE_MARKER_FAMILY, assertScopedFilter, createRunMarker, ownedByRun } from "./probe-guard.mjs";
import { markedTablesFor, teardown } from "./probe-ledger.mjs";

// ------------------------------------------------------------------- F6

test("F6 — every run gets a distinct, high-entropy marker", () => {
  const a = createRunMarker();
  const b = createRunMarker();
  assert.notEqual(a, b, "two runs must not collide");
  assert.match(a, new RegExp(`^${PROBE_MARKER_FAMILY}-[0-9a-f]{32}$`));
});

test("F6 — a weak or forged marker is refused rather than used", () => {
  assert.throws(() => createRunMarker("short"), /exactly 32 hex/);
  assert.throws(() => ownedByRun("pacemate-stage9-probe"), /refusing to build an ownership filter/);
  assert.throws(() => ownedByRun(""), /refusing to build an ownership filter/);
  assert.throws(() => ownedByRun(undefined), /refusing to build an ownership filter/);
});

test("F6 — ownership is a PREFIX match, so unrelated data containing the wording survives", () => {
  const runMarker = createRunMarker();
  const predicate = ownedByRun(runMarker);

  // The exact scenario the review described: real rows whose text merely
  // mentions the probe. Under the old `like.*marker*` substring match every one
  // of these was a deletion candidate.
  const innocent = [
    "Re: pacemate-probe cleanup went wrong last night",
    "notes about pacemate-stage9-probe and what it does",
    `a post quoting the whole marker ${runMarker} in the middle of a sentence`,
    `${PROBE_MARKER_FAMILY}-0000000000000000deadbeefdeadbeef`, // a DIFFERENT run
  ];

  // `like.<marker>%25` matches only values that START with this run's marker.
  const like = predicate.replace(/^like\./, "").replace(/%25$/, "");
  for (const value of innocent) {
    assert.ok(
      !value.startsWith(like),
      `"${value.slice(0, 48)}…" would have been treated as owned by this run`,
    );
  }

  // And the run's own rows ARE matched.
  assert.ok(`${runMarker}-course a`.startsWith(like));
  assert.ok(`${runMarker} university a`.startsWith(like));
});

test("F6 — the ownership filter passes the scoped-delete guard", () => {
  const runMarker = createRunMarker();
  for (const [table, column, predicate] of markedTablesFor(runMarker)) {
    assert.doesNotThrow(
      () => assertScopedFilter(`${column}=${predicate}`),
      `${table} predicate was rejected as unscoped`,
    );
  }
  // A whole-table delete is still refused.
  assert.throws(() => assertScopedFilter("name=neq.zzz"), /Refusing an unscoped delete/);
  assert.throws(() => assertScopedFilter(""), /Refusing an unscoped delete/);
});

test("F6 — the LIKE wildcard is URL-encoded, or PostgREST 500s", () => {
  // A bare `%` in a query string starts a percent-escape. The live probe
  // returned HTTP 500 on every residue read until this was encoded.
  assert.match(ownedByRun(createRunMarker()), /%25$/);
  assert.doesNotMatch(ownedByRun(createRunMarker()), /[^2]5$|%(?!25)/);
});

// ------------------------------------------------------------------- F5

test("F5 — a mutation stays registered until the UNDERLYING attempt settles", async () => {
  const scope = createAbortScope();
  let releaseServer;
  const serverDone = new Promise((resolve) => {
    releaseServer = resolve;
  });

  // A transport that ignores the abort signal entirely — which is the case the
  // wrapper's independent deadline was built for, and the case that makes the
  // wrapper's rejection meaningless as a signal that the work is over.
  const stubbornFetch = () =>
    serverDone.then(() => ({ status: 201, headers: new Headers(), text: async () => "{}" }));

  const wrapper = boundedRequest(
    "https://probe.test/rows",
    { method: "POST" },
    { timeoutMs: 50, fetchImpl: stubbornFetch, scope },
  );

  await assert.rejects(() => wrapper, /exceeded 50ms/);
  // THE POINT: the caller has given up, and the operation has not.
  assert.equal(scope.pendingMutations, 1, "the mutation must still be registered after the wrapper rejects");

  const tooEarly = await scope.settled(50);
  assert.equal(tooEarly.ok, false, "quiesce must NOT report settled while the request is open");
  assert.equal(tooEarly.outstanding, 1);

  releaseServer();
  const eventually = await scope.settled(1_000);
  assert.equal(eventually.ok, true, "once the server responds, the registry drains");
  assert.equal(scope.pendingMutations, 0);
});

test("F5 — reads are not tracked: a GET that never returned created nothing", async () => {
  const scope = createAbortScope();
  const never = () => new Promise(() => {});
  await assert.rejects(() =>
    boundedRequest("https://probe.test/rows", { method: "GET" }, { timeoutMs: 30, fetchImpl: never, scope }),
  );
  assert.equal(scope.pendingMutations, 0, "a read must not hold up quiesce");
});

test("F5 — an empty registry settles immediately", async () => {
  const scope = createAbortScope();
  const result = await scope.settled(10);
  assert.deepEqual(result, { ok: true, outstanding: 0 });
});

// ------------------------------------------------------------------- F7

function fakeLedger(failures = []) {
  return { cleanup: async () => failures };
}
const quietLogger = { error() {}, log() {} };

test("F7 — teardown reports a SWEEP failure distinctly, and it is not ok", async () => {
  const runMarker = createRunMarker();
  const rest = {
    select: async () => [],
    // Every delete fails: this is the sweep being unable to prove cleanup.
    remove: async () => {
      throw new Error("injected sweep failure");
    },
  };

  const result = await teardown({
    ledger: fakeLedger(),
    rest,
    auth: null,
    runMarker,
    logger: quietLogger,
  });

  assert.equal(result.ok, false, "a sweep that could not run is not a clean teardown");
  assert.ok(result.swept.failures.length > 0, "the failures must be reported, not swallowed");
  assert.match(result.detail, /sweep failure/);
});

test("F7 — a clean ledger with a failing sweep must still be NOT ok", async () => {
  // The exact hole: ledger cleanup succeeded, residue read succeeded, and the
  // runner based its exit on those two alone.
  const runMarker = createRunMarker();
  let removeCalls = 0;
  const rest = {
    select: async () => [],
    remove: async () => {
      removeCalls += 1;
      throw new Error("injected sweep failure");
    },
  };

  const result = await teardown({
    ledger: fakeLedger([]), // no ledger failures
    rest,
    // A real auth stub, so residue verification genuinely reads clean and the
    // SWEEP is isolated as the only thing that failed. (With auth: null,
    // verifyNoResidue correctly records "no auth client supplied" as
    // unverifiable — which is right, but would mask what this test is about.)
    auth: { listUsersByEmailPrefix: async () => [] },
    runMarker,
    logger: quietLogger,
  });

  assert.ok(removeCalls > 0, "the sweep must have been attempted");
  assert.deepEqual(result.failures, [], "the ledger really was clean");
  assert.equal(result.residue.clean, true, "residue really did read clean");
  assert.equal(result.ok, false, "yet the teardown must fail, because the sweep could not be proven");
});

test("F7 — the runner's exit expression includes the sweep result", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../rls-probe.mjs", import.meta.url), "utf8");
  const code = source
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

  assert.match(code, /sweepFailures\.length === 0/, "the sweep result must gate the exit code");
  assert.match(code, /cleanupFailures\.length === 0/);
  assert.match(code, /residue\.clean/);
  assert.match(code, /!provisionOrProbeError/);
  assert.match(code, /failed === 0/);
});
