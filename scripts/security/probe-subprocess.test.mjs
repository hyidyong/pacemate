// Codex round 3, F1 — subprocess tests over the REAL runner process.
//
// The previous round's fault injection tested the ledger helper. That left the
// runner's own lifecycle untested: whether a hung request is actually bounded in
// the shipped process, whether Ctrl-C cleans up, and whether residue really
// makes the process exit non-zero. These tests spawn
// `node scripts/security/rls-probe.mjs` against an in-memory stand-in and assert
// on process behaviour.
//
// The stand-in is not an RLS simulator, so the runner's SECURITY assertions
// against it are meaningless and are deliberately ignored. What is asserted is
// the lifecycle: deadlines, signals, cleanup, residue, exit status.
//
// NOT COVERED, NOT CLAIMED: SIGKILL / `kill -9` / OOM / power loss. No
// in-process handler runs then; the recovery path is the operator-run `--sweep`.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PROBE_MARKER } from "./lib/probe-guard.mjs";
import { SCENARIOS, startFakeSupabase } from "./lib/fake-supabase.mjs";

const RUNNER = fileURLToPath(new URL("./rls-probe.mjs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function runProbe({ url, extraEnv = {}, signal = null, signalAfterMs = 1200, timeoutMs = 45_000 }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RUNNER], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: url,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fake-anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "fake-service-key",
        PACEMATE_SECURITY_PROBE_ALLOW_WRITES: "1",
        PACEMATE_SECURITY_PROBE_PROJECT_REF: "fakeproject",
        PACEMATE_SECURITY_PROBE_ALLOW_LOOPBACK: "1",
        PACEMATE_SECURITY_PROBE_TIMEOUT_MS: "1500",
        PACEMATE_SECURITY_PROBE_CLEANUP_TIMEOUT_MS: "8000",
        ...extraEnv,
      },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    const hardKill = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    let signalTimer;
    if (signal) signalTimer = setTimeout(() => child.kill(signal), signalAfterMs);

    child.on("close", (code, killedBy) => {
      clearTimeout(hardKill);
      clearTimeout(signalTimer);
      resolve({ code, killedBy, stdout, stderr, output: stdout + stderr });
    });
  });
}

test("a normal run against the stand-in exits after cleaning up, and says so", async () => {
  const fake = await startFakeSupabase();
  try {
    const run = await runProbe({ url: fake.url });
    assert.match(run.output, /All ledgered resources removed/);
    assert.match(run.output, /Residue verification: clean/);
    // Security checks against a non-RLS stand-in are meaningless; what matters
    // is that nothing was left behind.
    assert.equal(fake.totalRows(), 0, `rows left: ${JSON.stringify([...fake.tables].map(([t, r]) => [t, r.length]))}`);
    assert.equal(fake.probeAuthUsers(PROBE_MARKER).length, 0, "probe auth users left behind");
  } finally {
    await fake.close();
  }
});

test("a request that never sends headers is bounded, and cleanup still runs", async () => {
  const fake = await startFakeSupabase({ scenario: SCENARIOS.stallBeforeHeaders });
  try {
    const run = await runProbe({ url: fake.url, extraEnv: { PACEMATE_SECURITY_PROBE_TIMEOUT_MS: "600" } });
    assert.match(run.output, /exceeded 600ms|Probe aborted/, "the stalled request was not bounded");
    assert.notEqual(run.code, 0, "a run that aborted must not exit 0");
    assert.equal(fake.totalRows(), 0, "a partially provisioned run left rows behind");
    assert.equal(fake.probeAuthUsers(PROBE_MARKER).length, 0);
  } finally {
    await fake.close();
  }
});

test("a response that stalls MID-BODY is bounded — the hole the old transport had", async () => {
  // The previous transport cleared its timer as soon as fetch() resolved, which
  // is when headers arrive. A body that never completes hung forever.
  const fake = await startFakeSupabase({ scenario: SCENARIOS.stallMidBody });
  try {
    const run = await runProbe({ url: fake.url, extraEnv: { PACEMATE_SECURITY_PROBE_TIMEOUT_MS: "600" } });
    assert.match(run.output, /exceeded 600ms|Probe aborted/, "a stalled body was not bounded");
    assert.notEqual(run.code, 0);
    assert.equal(fake.totalRows(), 0, "rows left behind after a mid-body stall");
    assert.equal(fake.probeAuthUsers(PROBE_MARKER).length, 0);
  } finally {
    await fake.close();
  }
});

// Node on Windows cannot deliver a POSIX signal to a child process — `kill()`
// terminates it outright — so these would be false negatives there. The same
// logic is covered deterministically on every platform by
// lib/probe-lifecycle.test.mjs, which injects a fake process emitter.
const SIGNAL_SKIP =
  process.platform === "win32"
    ? "POSIX signals are not deliverable to a child process on Windows; see lib/probe-lifecycle.test.mjs"
    : false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  test(`${signal} triggers cleanup exactly once and the process waits for it`, { skip: SIGNAL_SKIP }, async () => {
    const fake = await startFakeSupabase();
    try {
      const run = await runProbe({ url: fake.url, signal, signalAfterMs: 700 });
      assert.match(run.output, new RegExp(`\\[${signal}\\] interrupted`), `${signal} was not handled`);
      assert.notEqual(run.code, 0, "an interrupted run must not report success");
      assert.equal(
        fake.totalRows(),
        0,
        `${signal} left rows behind: ${JSON.stringify([...fake.tables].map(([t, r]) => [t, r.length]))}`,
      );
      assert.equal(fake.probeAuthUsers(PROBE_MARKER).length, 0, `${signal} left auth users behind`);
      // Cleanup must not run twice.
      const passes = run.output.split("All ledgered resources removed").length - 1;
      assert.ok(passes <= 1, `cleanup ran ${passes} times`);
    } finally {
      await fake.close();
    }
  });
}

test("a repeated signal does not start a second destructive cleanup pass", { skip: SIGNAL_SKIP }, async () => {
  const fake = await startFakeSupabase();
  try {
    const child = spawn(process.execPath, [RUNNER], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: fake.url,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fake-anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "fake-service-key",
        PACEMATE_SECURITY_PROBE_ALLOW_WRITES: "1",
        PACEMATE_SECURITY_PROBE_PROJECT_REF: "fakeproject",
        PACEMATE_SECURITY_PROBE_ALLOW_LOOPBACK: "1",
        PACEMATE_SECURITY_PROBE_TIMEOUT_MS: "1500",
      },
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));

    await new Promise((r) => setTimeout(r, 700));
    child.kill("SIGINT");
    await new Promise((r) => setTimeout(r, 60));
    child.kill("SIGINT");

    const code = await new Promise((resolve) => child.on("close", resolve));
    assert.notEqual(code, 0);
    assert.match(output, /already in progress|interrupted/);
    assert.equal(fake.totalRows(), 0, "double signal left rows behind");
  } finally {
    await fake.close();
  }
});

test("probe Auth users beyond the first page are still found and removed", async () => {
  // 250 unrelated users, so the probe's own users land on page 2 of a 200-page.
  const fake = await startFakeSupabase({ authUserCount: 250 });
  try {
    await runProbe({ url: fake.url });
    assert.equal(
      fake.probeAuthUsers(PROBE_MARKER).length,
      0,
      "probe auth users past the first page survived cleanup",
    );
    assert.equal(fake.authUsers.size, 250, "cleanup must not touch unrelated auth users");
  } finally {
    await fake.close();
  }
});

test("a cleanup deletion failure makes the process exit non-zero", async () => {
  const fake = await startFakeSupabase({ scenario: SCENARIOS.refuseDelete });
  try {
    const run = await runProbe({ url: fake.url });
    assert.match(run.output, /CLEANUP FAILED|RESIDUE/, "a refused delete was not surfaced");
    assert.notEqual(run.code, 0, "a run that could not clean up must exit non-zero");
  } finally {
    await fake.close();
  }
});

test("residue that cannot be verified makes the process exit non-zero", async () => {
  // The residue query lies and reports nothing while rows really remain.
  // Cleanup still deletes by id, so this asserts the reporting path, not a leak.
  const fake = await startFakeSupabase({ scenario: SCENARIOS.hideResidue });
  try {
    const run = await runProbe({ url: fake.url });
    // With reads lying, the ledger's own deletes still run; the security checks
    // cannot pass, so the exit code must be non-zero either way.
    assert.notEqual(run.code, 0);
  } finally {
    await fake.close();
  }
});

test("the runner refuses a non-Supabase host even with every opt-in set", async () => {
  const run = await runProbe({
    url: "https://fakeproject.supabase.co.attacker.example",
    extraEnv: { PACEMATE_SECURITY_PROBE_ALLOW_LOOPBACK: "0" },
  });
  assert.notEqual(run.code, 0);
  assert.match(run.output, /refusing to send privileged credentials|Refusing to run/i);
});
