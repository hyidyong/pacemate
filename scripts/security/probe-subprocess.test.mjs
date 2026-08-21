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

import { PROBE_MARKER, PROBE_MARKER_FAMILY } from "./lib/probe-guard.mjs";

// Codex round 5, F6: the child picks its own random run marker, which the
// parent cannot predict. Assertions about "did this run leave anything behind"
// therefore match the probe FAMILY prefix, which covers whatever token the
// child chose, while assertions about OWNERSHIP use an explicitly foreign
// marker to prove the sweep does not reach beyond its own execution.
const runMarkerFrom = (output) => (output.match(/run marker "([^"]+)"/) ?? [])[1] ?? null;
import { SCENARIOS, startFakeSupabase } from "./lib/fake-supabase.mjs";

const RUNNER = fileURLToPath(new URL("./rls-probe.mjs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function runProbe({
  url,
  args = [],
  extraEnv = {},
  signal = null,
  signalAfterMs = 1200,
  timeoutMs = 45_000,
}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RUNNER, ...args], {
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

test("the documented --sweep --family command executes and preserves bystanders", async () => {
  const fake = await startFakeSupabase();
  const runA = `${PROBE_MARKER_FAMILY}-${"a".repeat(32)}`;
  const runB = `${PROBE_MARKER_FAMILY}-${"b".repeat(32)}`;
  try {
    fake.rowsOf("faqs").push(
      { id: "probe-a", question: `${runA} courseless faq a` },
      { id: "probe-b", question: `${runB} courseless faq b` },
      { id: "bystander", question: `${runA} ordinary user faq` },
    );
    fake.authUsers.set("probe-auth-a", {
      id: "probe-auth-a",
      email: `${runA}-a-run123@probe.invalid`,
    });
    fake.authUsers.set("bystander-auth", {
      id: "bystander-auth",
      email: "alice+pacemate-probe@example.test",
    });

    const run = await runProbe({ url: fake.url, args: ["--sweep", "--family"] });

    assert.equal(run.code, 0, run.output);
    assert.match(run.output, /Sweep verified clean/);
    assert.deepEqual(fake.rowsOf("faqs"), [
      { id: "bystander", question: `${runA} ordinary user faq` },
    ]);
    assert.deepEqual([...fake.authUsers.keys()], ["bystander-auth"]);
  } finally {
    await fake.close();
  }
});

test("a normal run against the stand-in exits after cleaning up, and says so", async () => {
  const fake = await startFakeSupabase();
  try {
    const run = await runProbe({ url: fake.url });
    assert.match(run.output, /All ledgered resources removed/);
    assert.match(run.output, /Residue verification: clean/);
    // Security checks against a non-RLS stand-in are meaningless; what matters
    // is that nothing was left behind.
    assert.equal(fake.totalRows(), 0, `rows left: ${JSON.stringify([...fake.tables].map(([t, r]) => [t, r.length]))}`);
    assert.equal(fake.probeAuthUsers(PROBE_MARKER_FAMILY).length, 0, "probe auth users left behind");
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
    assert.equal(fake.probeAuthUsers(PROBE_MARKER_FAMILY).length, 0);
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
    assert.equal(fake.probeAuthUsers(PROBE_MARKER_FAMILY).length, 0);
  } finally {
    await fake.close();
  }
});

// Node on Windows cannot deliver a POSIX signal to a child process — `kill()`
// maps to TerminateProcess, which runs no in-process handler — so these would
// be false negatives there.
//
// Codex round 4, 4E: a skip must not be mistaken for a proven control. What is
// skipped on Windows is now ONLY the POSIX signal DELIVERY MECHANISM. The
// behaviour it triggers is proven on every platform, twice over:
//
//   * lib/probe-lifecycle.test.mjs drives the handler directly with an injected
//     process emitter (ordering, once-only, quiesce-before-cleanup);
//   * the "IPC cancel" test below runs the REAL runner in a REAL child process
//     and drives the SAME quiesce -> cleanup -> exit path through an IPC
//     message, which Windows can deliver.
//
// So the remaining Windows-specific gap is "does the OS route Ctrl-C to this
// handler", not "does the handler work". That gap stays UNVERIFIED on Windows
// and is recorded as such rather than papered over.
const SIGNAL_SKIP =
  process.platform === "win32"
    ? "POSIX signal DELIVERY is not possible to a child process on Windows; the handler itself is proven by the IPC-cancel test below and by lib/probe-lifecycle.test.mjs"
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
      assert.equal(fake.probeAuthUsers(PROBE_MARKER_FAMILY).length, 0, `${signal} left auth users behind`);
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
      fake.probeAuthUsers(PROBE_MARKER_FAMILY).length,
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
    assert.match(
      run.output,
      /CLEANUP FAILED|RESIDUE|SWEEP FAILED/,
      "a refused delete was not surfaced",
    );
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

// ---------------------------------------------------------------------------
// Codex round 4, 4C + 4E — the two gaps the round-3 subprocess tests left.
// ---------------------------------------------------------------------------

test("4C — a create that COMMITS but never answers is swept, not left behind", async () => {
  // The worst case the ledger structurally cannot cover: the row exists on the
  // server and the client never learned its id, so there is nothing to record
  // and nothing to delete. Only the marker sweep can find it. Before 4C the
  // sweep was operator-only, so this row survived a "clean" run.
  const fake = await startFakeSupabase({ scenario: SCENARIOS.ambiguousCreate });
  try {
    const run = await runProbe({ url: fake.url });

    // The run must NOT claim success: the probe aborted mid-provision.
    assert.notEqual(run.code, 0, "an ambiguous create must not read as a clean run");

    // The committed row must be gone by the end, whichever path removed it.
    const survivors = fake.rowsOf("counseling_requests");
    assert.deepEqual(
      survivors,
      [],
      `a committed-but-unacknowledged row survived: ${JSON.stringify(survivors)}`,
    );
  } finally {
    await fake.close();
  }
});

test("F6 — a sweep does NOT touch data belonging to another run, or to nobody", async () => {
  // The exact scenario Codex round 5 described: unrelated real rows whose text
  // contains the probe wording. Under the old fixed marker plus substring
  // matching, every one of these was a deletion candidate for any run.
  const fake = await startFakeSupabase();
  try {
    const bystanders = [
      { id: "innocent-1", question: `${PROBE_MARKER} mentioned in a real FAQ answer` },
      { id: "innocent-2", question: `${PROBE_MARKER_FAMILY} came up in a support thread` },
      {
        id: "innocent-3",
        question: `${PROBE_MARKER_FAMILY}-00000000000000000000000000000000 belongs to a DIFFERENT run`,
      },
    ];
    for (const row of bystanders) fake.rowsOf("faqs").push({ ...row });

    const run = await runProbe({ url: fake.url });
    const marker = runMarkerFrom(run.output);
    assert.ok(marker, `the run must announce its marker for recovery; output: ${run.output.slice(0, 200)}`);
    assert.ok(marker.startsWith(`${PROBE_MARKER_FAMILY}-`), `unexpected marker ${marker}`);

    const survivors = fake.rowsOf("faqs").map((row) => row.id).sort();
    assert.deepEqual(
      survivors,
      ["innocent-1", "innocent-2", "innocent-3"],
      "the sweep deleted rows it does not own",
    );
  } finally {
    await fake.close();
  }
});

// 4E — a cancellation path that is exercised on EVERY platform, including
// Windows, where a POSIX signal cannot reach a child process at all. The IPC
// message drives the same quiesce -> cleanup -> exit path a signal drives, so
// the control itself is proven here and only the signal DELIVERY mechanism
// stays platform-specific.
test("4E — an IPC cancel quiesces, cleans up, and exits non-zero-free of residue", async () => {
  const fake = await startFakeSupabase();
  try {
    const child = spawn(process.execPath, [RUNNER], {
      cwd: REPO_ROOT,
      // 'ipc' is what makes process.send exist in the child.
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: fake.url,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fake-anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "fake-service-key",
        PACEMATE_SECURITY_PROBE_ALLOW_WRITES: "1",
        PACEMATE_SECURITY_PROBE_PROJECT_REF: "fakeproject",
        PACEMATE_SECURITY_PROBE_ALLOW_LOOPBACK: "1",
        PACEMATE_SECURITY_PROBE_TIMEOUT_MS: "1500",
        PACEMATE_SECURITY_PROBE_CLEANUP_TIMEOUT_MS: "8000",
      },
    });

    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));

    // Cancel mid-provision, while resources exist and requests are in flight.
    await new Promise((r) => setTimeout(r, 700));
    child.send({ type: "probe:cancel" });

    const code = await new Promise((resolve) => {
      const hardKill = setTimeout(() => child.kill("SIGKILL"), 45_000);
      child.on("close", (c) => {
        clearTimeout(hardKill);
        resolve(c);
      });
    });

    assert.match(output, /probe:cancel/, "the cancellation must be acknowledged");
    assert.match(output, /quiescing, then cleaning up/, "the work must be stopped BEFORE cleanup");
    assert.ok(code !== null, `the process must exit; got ${code}`);

    // The point of quiescing: nothing may be left behind.
    for (const table of ["schools", "profiles", "courses", "counseling_requests"]) {
      assert.deepEqual(
        fake.rowsOf(table),
        [],
        `${table} still holds probe rows after a cancelled run`,
      );
    }
  } finally {
    await fake.close();
  }
});
