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

import { PROBE_MARKER, PROBE_TENANT_SLUG_PREFIX } from "./probe-guard.mjs";
import { ProbeLedger, sweepOrphans, verifyNoResidue } from "./probe-ledger.mjs";
import { provisionProbeTenants, provisionTenant } from "./probe-fixtures.mjs";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/**
 * An in-memory PostgREST stand-in that records every row and honours id-scoped
 * and marker-scoped deletes, so "did cleanup actually remove it" is observable.
 */
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
      const created = rows.map((row) => ({ ...row, id: `${table}-${++seq}` }));
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
        const needle = raw.replaceAll("*", "");
        return rows.filter((row) => typeof row[column] === "string" && row[column].includes(needle));
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
          const needle = raw.replaceAll("*", "");
          removed = rows.filter((row) => typeof row[column] === "string" && row[column].includes(needle));
          tables.set(table, rows.filter((row) => !removed.includes(row)));
        }
      }
      return removed;
    },
  };
}

function createFakeAuth({ failOnCreate = false, failOnDelete = false, failOnList = false } = {}) {
  const users = new Map();
  let seq = 0;
  return {
    users,
    async createUser(email) {
      if (failOnCreate) throw new Error("injected GoTrue create failure");
      const id = `auth-${++seq}`;
      users.set(id, { id, email });
      return { id, email };
    },
    async deleteUser(id) {
      if (failOnDelete) throw new Error("injected GoTrue delete failure");
      users.delete(id);
    },
    async listUsersByEmailPrefix(prefix) {
      if (failOnList) throw new Error("injected GoTrue list failure");
      return [...users.values()].filter((user) => user.email.includes(prefix));
    },
  };
}

/** The lifecycle the runner uses: provisioning is INSIDE the try. */
async function runLifecycle({ rest, auth, probe = async () => {} }) {
  const ledger = new ProbeLedger({ rest, auth });
  let provisionError = null;
  let cleanupFailures = [];
  let residue = null;
  try {
    const fixtures = await provisionProbeTenants(ledger);
    await probe(fixtures);
  } catch (error) {
    provisionError = error;
  } finally {
    cleanupFailures = await ledger.cleanup();
    residue = await verifyNoResidue({ rest, auth });
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

  const provisioning = provisionTenant(ledger, "a", "hang");
  // Give the provisioner enough turns to reach the stall.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(ledger.size >= 4, `expected recorded entries before the hang, got ${ledger.size}`);
  assert.ok(rest.totalRows() >= 4, "expected rows to exist before the hang");

  const failures = await ledger.cleanup();
  const residue = await verifyNoResidue({ rest, auth });

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
  await provisionProbeTenants(ledger);

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

  const residue = await verifyNoResidue({ rest, auth });

  assert.equal(residue.clean, false, "an unverifiable check must not read as clean");
  assert.ok(residue.unverifiable.some((entry) => entry.startsWith("courses")));
});

test("an unlistable Auth API is a failure, not a warning", async () => {
  const rest = createFakeRest();
  const auth = createFakeAuth({ failOnList: true });

  const residue = await verifyNoResidue({ rest, auth });

  assert.equal(residue.clean, false);
  assert.ok(residue.unverifiable.some((entry) => entry.startsWith("auth.users")));
});

test("leftover marked rows are detected even when the ledger is empty", async () => {
  const rest = createFakeRest();
  const auth = createFakeAuth();
  await rest.insert("schools", [{ name: "x", slug: `${PROBE_TENANT_SLUG_PREFIX}orphan` }]);
  await rest.insert("courses", [{ name: `${PROBE_MARKER} course orphan` }]);

  const residue = await verifyNoResidue({ rest, auth });

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
  await provisionProbeTenants(ledger);

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
  await provisionProbeTenants(ledger);
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
  await provisionProbeTenants(ledger);
  ledger.entries = []; // the process died; the ledger is gone

  assert.ok(rest.totalRows() > 0);
  assert.ok(auth.users.size > 0);

  const { failures } = await sweepOrphans({ rest, auth });
  const residue = await verifyNoResidue({ rest, auth });

  assert.deepEqual(failures, []);
  assert.equal(residue.clean, true, `residue after sweep: ${JSON.stringify(residue)}`);
  assert.equal(auth.users.size, 0);
});

test("the sweep reports failures rather than claiming success", async () => {
  const rest = createFakeRest({ failDeleteFor: (table) => table === "schools" });
  const auth = createFakeAuth();
  const ledger = new ProbeLedger({ rest, auth });
  await provisionProbeTenants(ledger);
  ledger.entries = [];

  const { failures } = await sweepOrphans({ rest, auth });
  assert.ok(failures.some((entry) => entry.startsWith("schools")));
});

// ---------------------------------------------------------------------------
// The runner's own lifecycle shape
// ---------------------------------------------------------------------------

test("the runner provisions inside the try and fails on residue", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../rls-probe.mjs", import.meta.url), "utf8");

  const tryIndex = source.indexOf("\n  try {");
  const provisionIndex = source.indexOf("await provisionProbeTenants(ledger)");
  assert.ok(tryIndex > -1 && provisionIndex > -1, "expected a top-level try and a provisioning call");
  assert.ok(
    tryIndex < provisionIndex,
    "provisioning must happen INSIDE the try, or a partial provision escapes cleanup",
  );

  // Cleanup and residue verification both run in the finally.
  assert.match(source, /finally \{\s*cleanupFailures = await ledger\.cleanup\(\);\s*residue = await verifyNoResidue/);

  // The exit code accounts for cleanup and residue, not only the security checks.
  assert.match(source, /failed === 0 &&\s*cleanupFailures\.length === 0 &&\s*residue\.clean/);

  // The old swallow-and-log behaviour must not return.
  assert.doesNotMatch(source, /teardownProbeTenants/);
  assert.doesNotMatch(source, /verifyTornDown/);
});
