// Codex finding 1 — fault injection over the probe harness's cleanup path.
//
// A harness that provisions rows and auth users in a LIVE project is only safe
// if cleanup survives failure. These tests inject a failure after every
// meaningful provisioning boundary and assert that nothing is left behind, that
// a cleanup failure is fatal rather than swallowed, and that residue which
// cannot be VERIFIED is also fatal.
//
// Everything runs against in-memory fakes: no network, no database. The point
// is the cleanup contract, and a contract that needs a live project to test is
// a contract nobody re-tests.
//
// NOT TESTED, AND NOT CLAIMED: survival of SIGKILL, a host OOM kill, or power
// loss. `finally` does not run in those cases. The independent recovery
// mechanism for them is the operator-run sweep, covered by its own test below.

import assert from "node:assert/strict";
import test from "node:test";

import { createRunMarker } from "./probe-guard.mjs";

// Codex round 5, F6: ownership is per execution now, so these fault-injection
// tests each mint their own marker rather than sharing a module constant. That
// is also what the real runners do.
const RUN_MARKER = createRunMarker();
import { ProbeLedger, sweepOrphans, teardown, verifyNoResidue } from "./probe-ledger.mjs";
import { provisionProbeTenants, provisionTenant } from "./probe-fixtures.mjs";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/**
 * An in-memory PostgREST stand-in that records every row and honours id-scoped
 * and marker-scoped deletes, so "did cleanup actually remove it" is observable.
 */
// Codex round 5, F6: predicates are now `like.<runMarker>%25` — a PREFIX match
// with a URL-encoded wildcard. The stand-in must model that, or it would keep
// answering the old substring semantics and the tests would pass against
// behaviour the real database no longer has.
function likeMatches(value, raw) {
  if (typeof value !== "string") return false;
  // The caller may hand us either the raw query text or an already-decoded
  // value, depending on whether a URL parser has been through it. Decoding a
  // decoded string throws URIError on a bare `%`, so fall back rather than
  // crash the stand-in.
  let pattern;
  try {
    pattern = decodeURIComponent(raw);
  } catch {
    pattern = raw;
  }
  pattern = pattern.replaceAll("*", "%");
  if (pattern.endsWith("%")) return value.startsWith(pattern.slice(0, -1));
  return value === pattern;
}

function createFakeRest({ failOn = () => false, failDeleteFor = () => false } = {}) {
  const tables = new Map();
  let seq = 0;
  const calls = [];

  const rowsOf = (table) => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table);
  };

  return {
    tables,
    calls,
    remaining() {
      const out = {};
      for (const [table, rows] of tables) if (rows.length) out[table] = rows.length;
      return out;
    },
    totalRows() {
      let n = 0;
      for (const rows of tables.values()) n += rows.length;
      return n;
    },
    async insert(table, rows) {
      calls.push({ op: "insert", table });
      if (failOn(table, "insert")) throw new Error(`injected insert failure on ${table}`);
      const created = rows.map((row) => ({
        ...row,
        id: row.id ?? `${table}-${++seq}`,
      }));
      rowsOf(table).push(...created);
      return created;
    },
    async select(table, query) {
      calls.push({ op: "select", table, query });
      if (failOn(table, "select")) throw new Error(`injected select failure on ${table}`);
      const rows = rowsOf(table);
      const idMatch = /(^|&)id=eq\.([^&]+)/.exec(query ?? "");
      if (idMatch) return rows.filter((row) => row.id === idMatch[2]);
      // Marker predicates: `<column>=like.*marker*` or `like.prefix*`.
      const likeMatch = /(\w+)=like\.([^&]+)/.exec(query ?? "");
      if (likeMatch) {
        const [, column, raw] = likeMatch;
        return rows.filter((row) => likeMatches(row[column], raw));
      }
      return rows;
    },
    async update(table, query, patch) {
      calls.push({ op: "update", table });
      const idMatch = /(^|&)id=eq\.([^&]+)/.exec(query ?? "");
      for (const row of rowsOf(table)) if (!idMatch || row.id === idMatch[2]) Object.assign(row, patch);
      return [];
    },
    async remove(table, query) {
      calls.push({ op: "remove", table, query });
      if (failDeleteFor(table, query)) throw new Error(`injected delete failure on ${table}`);
      const rows = rowsOf(table);
      const idMatch = /(^|&)id=eq\.([^&]+)/.exec(query ?? "");
      let removed = [];
      if (idMatch) {
        removed = rows.filter((row) => row.id === idMatch[2]);
        tables.set(table, rows.filter((row) => row.id !== idMatch[2]));
      } else {
        const likeMatch = /(\w+)=like\.([^&]+)/.exec(query ?? "");
        if (likeMatch) {
          const [, column, raw] = likeMatch;
          removed = rows.filter((row) => likeMatches(row[column], raw));
          tables.set(table, rows.filter((row) => !removed.includes(row)));
        }
      }
      return removed;
    },
  };
}

function createFakeAuth({ failOnCreate = false, failOnDelete = false, failOnList = false } = {}) {
  const users = new Map();
  const createCalls = [];
  let seq = 0;
  return {
    users,
    createCalls,
    async createUser(email, password) {
      if (failOnCreate) throw new Error("injected GoTrue create failure");
      const id = `auth-${++seq}`;
      users.set(id, { id, email });
      createCalls.push({ email, password });
      return { id, email };
    },
    async deleteUser(id) {
      if (failOnDelete) throw new Error("injected GoTrue delete failure");
      users.delete(id);
    },
    async listUsersByEmailPrefix(prefix) {
      if (failOnList) throw new Error("injected GoTrue list failure");
      // Exact prefix, matching the real client since F6.
      return [...users.values()].filter((user) => user.email.startsWith(prefix));
    },
  };
}

test("fixture principals share only their own run's secret and still authenticate", async () => {
  const provision = async (marker) => {
    const rest = createFakeRest();
    const auth = createFakeAuth();
    const ledger = new ProbeLedger({ rest, auth });
    const fixtures = await provisionProbeTenants(ledger, marker, "run123");
    return { auth, fixtures, ledger, rest };
  };

  const first = await provision(createRunMarker("d".repeat(32)));
  const second = await provision(createRunMarker("e".repeat(32)));

  assert.notEqual(first.fixtures.authSecret, second.fixtures.authSecret);
  assert.ok(first.auth.createCalls.length >= 6, "every temporary role must be provisioned");
  assert.ok(
    first.auth.createCalls.every(({ password }) => password === first.fixtures.authSecret),
    "all principals in one run must use only that run's in-memory secret",
  );
  assert.ok(
    first.auth.createCalls.every(
      ({ email, password }) => !email.includes(password) && !password.includes(first.fixtures.runMarker),
    ),
    "emails and run identifiers must not reveal the secret",
  );
  const signIn = (email, password) =>
    first.auth.createCalls.some((call) => call.email === email && call.password === password);
  assert.equal(signIn(first.fixtures.tenants.A.email, first.fixtures.authSecret), true);

  const cleaned = await teardown({
    ledger: first.ledger,
    rest: first.rest,
    auth: first.auth,
    runMarker: first.fixtures.runMarker,
  });
  assert.equal(cleaned.ok, true);
  assert.equal(first.auth.users.size, 0);
});

/** The lifecycle the runner uses: provisioning is INSIDE the try. */
async function runLifecycle({ rest, auth, probe = async () => {} }) {
  const ledger = new ProbeLedger({ rest, auth });
  let provisionError = null;
  let cleanupFailures = [];
  let residue = null;
  try {
    const fixtures = await provisionProbeTenants(ledger, RUN_MARKER);
    await probe(fixtures);
  } catch (error) {
    provisionError = error;
  } finally {
    cleanupFailures = await ledger.cleanup();
    residue = await verifyNoResidue({ rest, auth, runMarker: RUN_MARKER });
  }
  return { ledger, provisionError, cleanupFailures, residue };
}

// ---------------------------------------------------------------------------
// Fault injection after every provisioning boundary
// ---------------------------------------------------------------------------

const BOUNDARIES = [
  "schools",
  "departments",
  "professors",
  "courses",
  "professor_availability",
  "profiles",
  "student_profiles",
  "student_courses",
  "counseling_requests",
  "user_notifications",
  "student_mission_progress",
  "academic_terms",
  "course_offerings",
  "student_course_progress",
  "student_weekly_progress",
  "chat_sessions",
  "chat_messages",
  "escalations",
  "comments",
  "post_reactions",
  "reports",
  "professor_admin_tasks",
  "study_roadmaps",
  "study_tasks",
  "roadmap_requests",
  "roadmap_results",
  "professor_question_auto_reply_rules",
  "syllabi",
  "professor_teaching_slots",
  "course_professors",
  "notices",
];

for (const boundary of BOUNDARIES) {
  test(`failure at the ${boundary} boundary leaves zero rows and zero auth users`, async () => {
    const rest = createFakeRest({ failOn: (table, op) => table === boundary && op === "insert" });
    const auth = createFakeAuth();

    const { provisionError, cleanupFailures, residue } = await runLifecycle({ rest, auth });

    assert.ok(provisionError, "provisioning was expected to fail");
    assert.match(provisionError.message, new RegExp(boundary));
    assert.deepEqual(cleanupFailures, [], "cleanup reported failures");
    assert.equal(rest.totalRows(), 0, `rows left behind: ${JSON.stringify(rest.remaining())}`);
    assert.equal(auth.users.size, 0, "auth users left behind");
    assert.equal(residue.clean, true, `residue: ${JSON.stringify(residue)}`);
  });
}

test("failure creating the Auth user leaves zero database rows behind", async () => {
  const rest = createFakeRest();
  const auth = createFakeAuth({ failOnCreate: true });

  const { provisionError, cleanupFailures, residue } = await runLifecycle({ rest, auth });

  assert.match(provisionError.message, /injected GoTrue create failure/);
  assert.deepEqual(cleanupFailures, []);
  assert.equal(rest.totalRows(), 0, `rows left behind: ${JSON.stringify(rest.remaining())}`);
  assert.equal(auth.users.size, 0);
  assert.equal(residue.clean, true);
});

test("failure DURING the probe, after full provisioning, still cleans up", async () => {
  const rest = createFakeRest();
  const auth = createFakeAuth();

  const { provisionError, cleanupFailures, residue } = await runLifecycle({
    rest,
    auth,
    probe: async () => {
      throw new Error("injected probe failure");
    },
  });

  assert.match(provisionError.message, /injected probe failure/);
  assert.deepEqual(cleanupFailures, []);
  assert.equal(rest.totalRows(), 0);
  assert.equal(auth.users.size, 0);
  assert.equal(residue.clean, true);
});

test("cleanup runs even when provisionTenant never returns", async () => {
  // A provisioner that hangs forever. The ledger belongs to the CALLER, so the
  // caller can abandon the provisioning promise and still clean up everything
  // recorded so far — which is the property the old design lacked, because the
  // fixture object only existed inside the function that never returned.
  const rest = createFakeRest();
  const auth = createFakeAuth();
  const ledger = new ProbeLedger({ rest, auth });

  let neverSettles;
  const hanging = new Promise((resolve) => {
    neverSettles = resolve;
  });

  const original = rest.insert.bind(rest);
  let inserts = 0;
  rest.insert = async (table, rows) => {
    inserts += 1;
    if (inserts > 4) return hanging; // stall partway through tenant A
    return original(table, rows);
  };

  const provisioning = provisionTenant(ledger, "a", "hang1", RUN_MARKER);
  // Give the provisioner enough turns to reach the stall.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(ledger.size >= 4, `expected recorded entries before the hang, got ${ledger.size}`);
  assert.ok(rest.totalRows() >= 4, "expected rows to exist before the hang");

  const failures = await ledger.cleanup();
  const residue = await verifyNoResidue({ rest, auth, runMarker: RUN_MARKER });

  assert.deepEqual(failures, []);
  assert.equal(rest.totalRows(), 0, `rows left behind: ${JSON.stringify(rest.remaining())}`);
  assert.equal(residue.clean, true);

  neverSettles();
  provisioning.catch(() => {});
});

// ---------------------------------------------------------------------------
// Cleanup failures must be fatal, never swallowed
// ---------------------------------------------------------------------------

test("a database deletion failure is reported, not swallowed", async () => {
  const rest = createFakeRest({ failDeleteFor: (table) => table === "courses" });
  const auth = createFakeAuth();

  const { cleanupFailures } = await runLifecycle({ rest, auth });

  assert.ok(cleanupFailures.length > 0, "a failed delete must surface");
  assert.ok(
    cleanupFailures.every((failure) => failure.table === "courses"),
    `unexpected failures: ${JSON.stringify(cleanupFailures)}`,
  );
  // Everything else still gets removed — one stubborn row must not abort the rest.
  assert.deepEqual(Object.keys(rest.remaining()), ["courses"]);
});

test("an Auth deletion failure is reported, not swallowed", async () => {
  const rest = createFakeRest();
  const auth = createFakeAuth({ failOnDelete: true });

  const { cleanupFailures, residue } = await runLifecycle({ rest, auth });

  assert.ok(cleanupFailures.length > 0, "a failed auth delete must surface");
  assert.ok(cleanupFailures.some((failure) => failure.table === "auth.users"));
  assert.equal(residue.clean, false, "surviving auth users must show up as residue");
  assert.ok(residue.residue.some((entry) => entry.startsWith("auth.users")));
});

test("failed entries stay in the ledger so a retry can finish the job", async () => {
  let blocked = true;
  const rest = createFakeRest({ failDeleteFor: (table) => blocked && table === "courses" });
  const auth = createFakeAuth();
  const ledger = new ProbeLedger({ rest, auth });
  await provisionProbeTenants(ledger, RUN_MARKER);

  const first = await ledger.cleanup();
  assert.ok(first.length > 0);
  assert.equal(ledger.size, first.length, "failed entries must be retained");

  blocked = false;
  const second = await ledger.cleanup();
  assert.deepEqual(second, []);
  assert.equal(ledger.size, 0);
  assert.equal(rest.totalRows(), 0);
});

// ---------------------------------------------------------------------------
// Residue verification must fail closed
// ---------------------------------------------------------------------------

test("a residue check that cannot be performed is a failure, not a warning", async () => {
  const rest = createFakeRest({ failOn: (table, op) => table === "courses" && op === "select" });
  const auth = createFakeAuth();

  const residue = await verifyNoResidue({ rest, auth, runMarker: RUN_MARKER });

  assert.equal(residue.clean, false, "an unverifiable check must not read as clean");
  assert.ok(residue.unverifiable.some((entry) => entry.startsWith("courses")));
});

test("an unlistable Auth API is a failure, not a warning", async () => {
  const rest = createFakeRest();
  const auth = createFakeAuth({ failOnList: true });

  const residue = await verifyNoResidue({ rest, auth, runMarker: RUN_MARKER });

  assert.equal(residue.clean, false);
  assert.ok(residue.unverifiable.some((entry) => entry.startsWith("auth.users")));
});

test("leftover marked rows are detected even when the ledger is empty", async () => {
  const rest = createFakeRest();
  const auth = createFakeAuth();
  // Owned by THIS run: residue verification is run-scoped since F6, so a row
  // carrying only the legacy family prefix is deliberately NOT this run's.
  await rest.insert("schools", [{ name: "x", slug: `${RUN_MARKER}-orphan` }]);
  await rest.insert("courses", [{ name: `${RUN_MARKER} course orphan` }]);

  const residue = await verifyNoResidue({ rest, auth, runMarker: RUN_MARKER });

  assert.equal(residue.clean, false);
  assert.ok(residue.residue.some((entry) => entry.startsWith("schools")));
  assert.ok(residue.residue.some((entry) => entry.startsWith("courses")));
});

test("a clean run verifies clean", async () => {
  const rest = createFakeRest();
  const auth = createFakeAuth();
  const { provisionError, cleanupFailures, residue } = await runLifecycle({ rest, auth });

  assert.equal(provisionError, null);
  assert.deepEqual(cleanupFailures, []);
  assert.equal(residue.clean, true);
  assert.equal(rest.totalRows(), 0);
  assert.equal(auth.users.size, 0);
});

// ---------------------------------------------------------------------------
// Ordering and scoping
// ---------------------------------------------------------------------------

test("cleanup is strict reverse creation order, so children go before parents", async () => {
  const rest = createFakeRest();
  const auth = createFakeAuth();
  const ledger = new ProbeLedger({ rest, auth });
  await provisionProbeTenants(ledger, RUN_MARKER);

  const creationOrder = ledger.entries.map((entry) => entry.table ?? "auth.users");
  await ledger.cleanup();
  const deletionOrder = rest.calls.filter((call) => call.op === "remove").map((call) => call.table);

  const expected = creationOrder.filter((table) => table !== "auth.users").reverse();
  assert.deepEqual(deletionOrder, expected);

  const schoolAt = deletionOrder.lastIndexOf("schools");
  for (const child of ["departments", "courses", "professors", "profiles"]) {
    assert.ok(
      deletionOrder.lastIndexOf(child) < schoolAt,
      `${child} must be deleted before its parent school`,
    );
  }
});

test("every ledger delete is id-scoped, so cleanup can never become a truncate", async () => {
  const rest = createFakeRest();
  const auth = createFakeAuth();
  const ledger = new ProbeLedger({ rest, auth });
  await provisionProbeTenants(ledger, RUN_MARKER);
  await ledger.cleanup();

  for (const call of rest.calls.filter((entry) => entry.op === "remove")) {
    assert.match(call.query, /^id=eq\./, `unscoped delete: ${call.table} ${call.query}`);
  }
});

test("the ledger refuses to record a resource without an identifier", () => {
  const ledger = new ProbeLedger({ rest: createFakeRest(), auth: createFakeAuth() });
  assert.throws(() => ledger.recordRow("schools", null), /requires a table and an id/);
  assert.throws(() => ledger.recordRow(null, "abc"), /requires a table and an id/);
  assert.throws(() => ledger.recordAuthUser(null), /requires an id/);
});

// ---------------------------------------------------------------------------
// The independent recovery mechanism for the case `finally` cannot cover
// ---------------------------------------------------------------------------

test("the orphan sweep removes residue left by a killed run", async () => {
  // Simulates SIGKILL: rows and an auth user exist, and no ledger survived.
  const rest = createFakeRest();
  const auth = createFakeAuth();
  const ledger = new ProbeLedger({ rest, auth });
  await provisionProbeTenants(ledger, RUN_MARKER);
  ledger.entries = []; // the process died; the ledger is gone

  assert.ok(rest.totalRows() > 0);
  assert.ok(auth.users.size > 0);

  const { failures } = await sweepOrphans({ rest, auth, runMarker: RUN_MARKER });
  const residue = await verifyNoResidue({ rest, auth, runMarker: RUN_MARKER });

  assert.deepEqual(failures, []);
  assert.equal(residue.clean, true, `residue after sweep: ${JSON.stringify(residue)}`);
  assert.equal(auth.users.size, 0);
});

test("family recovery removes only structurally valid probe runs", async () => {
  const ledgerModule = await import("./probe-ledger.mjs");
  assert.equal(
    typeof ledgerModule.sweepProbeFamily,
    "function",
    "family recovery must be separate from exact-run ownership",
  );

  const runA = createRunMarker("a".repeat(32));
  const runB = createRunMarker("b".repeat(32));
  const rest = createFakeRest();
  const auth = createFakeAuth();
  auth.listProbeFamilyUsers = async () =>
    [...auth.users.values()].filter((user) =>
      /^pacemate-probe-[0-9a-f]{32}-(?:(?:prof-)?[ab]|notif-[ab])-[a-z0-9]+@probe\.invalid$/.test(user.email),
    );

  await rest.insert("faqs", [
    { id: "run-a", question: `${runA} courseless faq a` },
    { id: "run-b", question: `${runB} courseless faq b` },
    { id: "words-only", question: "notes containing pacemate-probe in the middle" },
    { id: "malformed", question: "pacemate-probe-not-a-run courseless faq" },
    { id: "unexpected-shape", question: `${createRunMarker("c".repeat(32))} ordinary user faq` },
  ]);
  await rest.insert("schools", [
    { id: "notif-school", slug: `${runB}-notif-home-run456` },
    { id: "similar-school", slug: `${runB}-customer-home-run456` },
  ]);
  await rest.insert("user_notifications", [
    { id: "notif-row", title: `${runB} own direct run456` },
    { id: "similar-notif", title: `${runB} ordinary direct run456` },
  ]);
  await auth.createUser(`${runA}-a-run123@probe.invalid`);
  await auth.createUser(`${runB}-prof-b-run456@probe.invalid`);
  await auth.createUser(`${runB}-notif-a-run456@probe.invalid`);
  await auth.createUser("alice+pacemate-probe@example.test");

  const exact = await sweepOrphans({ rest, auth, runMarker: runA });
  assert.deepEqual(exact.failures, []);
  assert.deepEqual(rest.tables.get("faqs").map((row) => row.id).sort(), [
    "malformed",
    "run-b",
    "unexpected-shape",
    "words-only",
  ]);
  assert.deepEqual(rest.tables.get("schools").map((row) => row.id), [
    "notif-school",
    "similar-school",
  ]);
  assert.deepEqual(rest.tables.get("user_notifications").map((row) => row.id), [
    "notif-row",
    "similar-notif",
  ]);

  const family = await ledgerModule.sweepProbeFamily({ rest, auth });
  assert.deepEqual(family.failures, []);
  assert.deepEqual(rest.tables.get("faqs").map((row) => row.id).sort(), [
    "malformed",
    "unexpected-shape",
    "words-only",
  ]);
  assert.deepEqual(rest.tables.get("schools").map((row) => row.id), ["similar-school"]);
  assert.deepEqual(rest.tables.get("user_notifications").map((row) => row.id), ["similar-notif"]);
  assert.deepEqual([...auth.users.values()].map((user) => user.email), [
    "alice+pacemate-probe@example.test",
  ]);
});

test("the sweep reports failures rather than claiming success", async () => {
  const rest = createFakeRest({ failDeleteFor: (table) => table === "schools" });
  const auth = createFakeAuth();
  const ledger = new ProbeLedger({ rest, auth });
  await provisionProbeTenants(ledger, RUN_MARKER);
  ledger.entries = [];

  const { failures } = await sweepOrphans({ rest, auth, runMarker: RUN_MARKER });
  assert.ok(failures.some((entry) => entry.startsWith("schools")));
});

// ---------------------------------------------------------------------------
// The runner's own lifecycle shape
// ---------------------------------------------------------------------------

test("the runner's lifecycle covers provisioning, signals and residue", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../rls-probe.mjs", import.meta.url), "utf8");

  // Provisioning must sit INSIDE the guarded body, or a partial provision
  // escapes cleanup.
  const bodyStart = source.indexOf("await lifecycle.run(async () => {");
  const provision = source.indexOf("await provisionProbeTenants(ledger, runMarker)");
  assert.ok(bodyStart > -1, "the runner must use the signal-aware lifecycle");
  assert.ok(bodyStart < provision, "provisioning must happen inside lifecycle.run");

  // Cleanup is the lifecycle's cleanup callback, so it also runs on
  // SIGINT/SIGTERM — not only in a `finally`.
  assert.match(source, /cleanup: async \(\) => \{[\s\S]*?teardown\(\{ ledger, rest, auth, runMarker \}\)/);

  // Codex round 4, 4A: the work scope must be cancelled BEFORE cleanup, or a
  // create still on the wire can commit after cleanup has already looked.
  assert.match(source, /abortWork: \(reason\) => scope\.abort\(reason\)/);
  assert.match(source, /createAbortScope\(\)/);

  // The exit code accounts for cleanup, the SWEEP and residue, not only
  // security checks. Codex round 5, F7: the sweep term was the missing one —
  // teardown computed it and the runner threw it away, so a `[SWEEP FAILED]`
  // run could exit 0.
  assert.match(source, /failed === 0 &&/);
  assert.match(source, /cleanupFailures\.length === 0 &&/);
  assert.match(source, /sweepFailures\.length === 0 &&/);
  assert.match(source, /residue\.clean &&/);
  assert.match(source, /!provisionOrProbeError;/);

  // Every probe request goes through the bounded transport; no bare fetch.
  assert.doesNotMatch(source, /await fetch\(/, "the runner must not call fetch directly");
  assert.match(source, /createRoleClient/);

  // The swallow-and-log behaviour must not return.
  assert.doesNotMatch(source, /teardownProbeTenants/);
  assert.doesNotMatch(source, /verifyTornDown/);
});

test("4C — teardown is ledger, THEN marker sweep, THEN residue verification", async () => {
  // The order matters and so does the conjunction. The sweep exists because a
  // create that times out can commit without the ledger ever learning its id,
  // so a run is clean only when all three agree.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./probe-ledger.mjs", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export async function teardown"));
  const code = body
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
    .join("\n");

  const ledgerAt = code.indexOf("ledger.cleanup()");
  const sweepAt = code.indexOf("sweepOrphans(");
  const residueAt = code.indexOf("verifyNoResidue(");
  assert.ok(ledgerAt > -1 && sweepAt > -1 && residueAt > -1, "all three phases must run");
  assert.ok(ledgerAt < sweepAt, "the ledger runs before the sweep");
  assert.ok(sweepAt < residueAt, "residue verification runs last, over the final state");

  assert.match(
    code,
    /failures\.length === 0 && swept\.failures\.length === 0 && residue\.clean/,
    "a run is clean only when the ledger, the sweep AND residue verification all agree",
  );
});

test("4C — an ambiguous mutation is reported as ambiguous, not as a failure", async () => {
  // The transport must distinguish "the server refused" from "I never found
  // out", because only the second one may have left a committed row.
  const { boundedRequest } = await import("./probe-http.mjs");
  const never = () => new Promise(() => {});

  await assert.rejects(
    () => boundedRequest("https://probe.test/x", { method: "POST" }, { timeoutMs: 50, fetchImpl: never }),
    (error) => error.ambiguous === true,
  );
  await assert.rejects(
    () => boundedRequest("https://probe.test/x", { method: "GET" }, { timeoutMs: 50, fetchImpl: never }),
    (error) => error.ambiguous === false,
  );
});

// ---------------------------------------------------------------------------
// Codex round 4, finding 7 — the audit probe is on the same harness as the rest.
// ---------------------------------------------------------------------------

test("F7 — the audit probe uses the bounded transport, not a bare fetch", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../audit-trail-probe.mjs", import.meta.url), "utf8");
  const code = source
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

  assert.doesNotMatch(code, /\bfetch\(/, "the audit probe must not call fetch directly");
  assert.match(code, /createRoleClient/, "anon traffic must go through the bounded transport");
  assert.match(code, /createProbeLifecycle/, "cleanup must run on SIGINT/SIGTERM too");
  assert.match(code, /abortWork: \(reason\) => scope\.abort\(reason\)/, "it must quiesce before cleanup");
  assert.match(code, /new ProbeLedger/, "the disposable profile must be ledgered");

  // The swallow-and-continue teardown must not come back.
  assert.doesNotMatch(code, /\.catch\(\(\) => \{\}\)/, "cleanup failures must not be swallowed");
});

test("F7 — the audit probe does NOT weaken append-only to tidy up after itself", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../audit-trail-probe.mjs", import.meta.url), "utf8");
  const code = source
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

  // Its own events must never be ledgered: the ledger deletes, and DELETE on
  // security_events does not exist for any role. Granting it so the harness
  // could clean up is the exact trade this stage refused.
  assert.doesNotMatch(
    code,
    /recordRow\("security_events"/,
    "audit events must not be ledgered — the ledger deletes, and they are permanent",
  );
  assert.doesNotMatch(
    code,
    /remove\("security_events"[\s\S]{0,120}created\.events\.map/,
    "the probe must not attempt a bulk removal of its own audit rows",
  );

  // The permanent residue must be REPORTED, not silently accepted.
  assert.match(code, /permanent test event\(s\)/);

  // And the run must still fail if the DISPOSABLE half was not cleaned.
  assert.match(code, /failed === 0 && cleanup\.ok && !bodyError && ranEverything/);
});

test("F7 — the snapshot still shows no role can delete the audit trail", async () => {
  const { readFileSync } = await import("node:fs");
  const snapshot = JSON.parse(
    readFileSync(new URL("../../../supabase/security-snapshot.json", import.meta.url), "utf8"),
  );
  for (const row of snapshot.effective_privileges.filter((r) => r.table === "security_events")) {
    assert.doesNotMatch(
      row.privileges,
      /DELETE|TRUNCATE|UPDATE/,
      `${row.role} can mutate the audit trail: ${row.privileges}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Codex round 5, F8 — a check whose verdict is a constant is not a check.
// ---------------------------------------------------------------------------

test("F8 — no probe check submits a literal PASS verdict", async () => {
  // The allow branch of the anon-read loop passed the literal `true` as its
  // `pass` argument. So `anon-read:course_reviews` was recorded as PASS while
  // the response was 401 — a denial for a table the probe's own metadata called
  // public-by-design. Four checks could not fail, and they were counted in the
  // headline total, which is why that total was withdrawn.
  //
  // Only a literal `true` is the danger. A literal `false` appears in the
  // "read-back FAILED — cannot verify" branches, where failing is the CORRECT
  // outcome: a check that could not be performed must not be reported as
  // safety. A constant that can only fail is honest; a constant that can only
  // pass is the bug. This scans for the latter.
  const { readFileSync } = await import("node:fs");
  const runners = [
    "../rls-probe.mjs",
    "../audit-trail-probe.mjs",
    "../../verify-notification-rls.mjs",
  ];

  const offenders = [];
  for (const runner of runners) {
    const source = readFileSync(new URL(runner, import.meta.url), "utf8");
    // check(id, property, VERDICT, detail) — the verdict is the third argument.
    // Matches a literal true/false in that position, across line breaks.
    const pattern = /check\(\s*[^,]+,\s*(?:`[^`]*`|"[^"]*"|'[^']*')\s*,\s*true\s*,/g;
    for (const match of source.matchAll(pattern)) {
      const line = source.slice(0, match.index).split(/\r?\n/).length;
      offenders.push(`${runner}:${line} — verdict is the literal true`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these checks cannot fail:\n  ${offenders.join("\n  ")}`,
  );
});

test("F8 — exactly one table is marked anon-readable, matching the live grant set", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../rls-probe.mjs", import.meta.url), "utf8");
  const table = source.slice(source.indexOf("const TABLES = ["), source.indexOf("];", source.indexOf("const TABLES = [")));
  const intended = [...table.matchAll(/\["([a-z_]+)",\s*true,/g)].map((m) => m[1]);
  assert.deepEqual(
    intended,
    ["schools"],
    `the probe's design intent must match the live anon grant set; found: ${intended.join(", ")}`,
  );

  // And the snapshot must agree — otherwise the probe and the database are
  // describing different systems, which is how the stale `true` survived.
  const snapshot = JSON.parse(
    readFileSync(new URL("../../../supabase/security-snapshot.json", import.meta.url), "utf8"),
  );
  const anonTables = snapshot.effective_privileges
    .filter((row) => row.role === "anon")
    .map((row) => row.table);
  assert.deepEqual(anonTables, ["schools"]);
});
