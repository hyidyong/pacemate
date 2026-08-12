// Codex F9 — drift guard over the generated security snapshot.
//
// `supabase/security-snapshot.json` is produced from the LIVE database by
// `scripts/security/dump-security-snapshot.mjs`. These tests assert the security
// invariants Stage 9 established against that snapshot, so a policy or grant
// that drifts shows up as a failing test rather than as a finding in the next
// review.
//
// Offline by design: the snapshot is committed, so this runs in the ordinary
// suite. To confirm the snapshot still matches the database, run
// `node scripts/security/dump-security-snapshot.mjs --check`, which needs
// credentials and is part of the release battery rather than the unit suite.
//
// Migration history remains authoritative. This file guards the RESULT.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const snapshot = JSON.parse(
  readFileSync(fileURLToPath(new URL("./security-snapshot.json", import.meta.url)), "utf8"),
);

const grantsFor = (grantee) => snapshot.grants.filter((row) => row.grantee === grantee);
const policiesFor = (table) => snapshot.policies.filter((row) => row.table === table);

test("the snapshot is populated and plausible", () => {
  assert.ok(snapshot.tables.length > 40, `only ${snapshot.tables.length} tables`);
  assert.ok(snapshot.policies.length > 40, `only ${snapshot.policies.length} policies`);
  assert.ok(snapshot.functions.length > 5);
});

test("RLS is enabled on every public table", () => {
  const unprotected = snapshot.tables.filter((row) => !row.rls).map((row) => row.table);
  assert.deepEqual(unprotected, [], `tables without RLS: ${unprotected.join(", ")}`);
});

test("anon reaches exactly one table, read-only", () => {
  // The Stage 9 invariant. `schools` is the tenant registry a caller needs
  // before it has an identity; everything else requires a session.
  const anon = grantsFor("anon");
  assert.deepEqual(
    anon.map((row) => `${row.table}:${row.privileges}`),
    ["schools:SELECT"],
    `unexpected anon grants: ${JSON.stringify(anon)}`,
  );

  const anonPolicies = snapshot.policies
    .filter((row) => row.roles.split(",").includes("anon"))
    .map((row) => `${row.table}.${row.policy}`);
  assert.deepEqual(anonPolicies, ["schools.public read schools"]);
});

test("no policy named 'demo …' survives", () => {
  const demo = snapshot.policies.filter((row) => row.policy.startsWith("demo "));
  assert.deepEqual(demo, [], `demo-era policies survive: ${demo.map((r) => r.table + "." + r.policy).join(", ")}`);
});

test("every SECURITY DEFINER function pins its search_path", () => {
  const loose = snapshot.functions
    .filter((row) => row.security_definer && !row.config.includes("search_path"))
    .map((row) => `${row.schema}.${row.name}`);
  assert.deepEqual(loose, [], `mutable search_path: ${loose.join(", ")}`);
});

test("the identity helpers are not exposed as PostgREST RPC", () => {
  // KI-011: they must live in app_private, which PostgREST does not expose.
  const exposed = snapshot.functions
    .filter((row) => row.schema === "public")
    .filter((row) => /^(is_professor_of_offering|is_student_of_offering|current_(profile|school|professor)_id)$/.test(row.name));
  assert.deepEqual(exposed, [], `identity helpers exposed in public: ${JSON.stringify(exposed)}`);

  for (const name of ["current_profile_id", "current_school_id", "current_professor_id", "current_user_role"]) {
    assert.ok(
      snapshot.functions.some((row) => row.schema === "app_private" && row.name === name),
      `missing app_private.${name}`,
    );
  }
});

test("counseling mutations are not reachable by a client role", () => {
  const counseling = snapshot.grants.filter(
    (row) => row.table === "counseling_requests" && row.grantee !== "service_role",
  );
  for (const row of counseling) {
    assert.doesNotMatch(row.privileges, /UPDATE|DELETE/, `${row.grantee} can mutate counseling rows`);
  }
  // No UPDATE/DELETE policy either.
  const mutating = policiesFor("counseling_requests").filter((row) => ["UPDATE", "DELETE"].includes(row.cmd));
  assert.deepEqual(mutating, []);
});

test("the audit trail is append-only and unwritable by client roles", () => {
  const client = snapshot.grants.filter(
    (row) => row.table === "security_events" && row.grantee !== "service_role",
  );
  for (const row of client) {
    assert.equal(row.privileges, "SELECT", `${row.grantee} has more than SELECT on security_events`);
  }
  assert.ok(
    snapshot.grants.some((row) => row.table === "security_events" && row.grantee === "service_role"),
    "service_role must hold explicit audit privileges, not incidental ones",
  );
  // Enforced by the database, not by convention.
  assert.ok(
    snapshot.triggers.some(
      (row) => row.table === "security_events" && row.trigger === "security_events_no_update_trg",
    ),
    "the append-only trigger is missing",
  );
  assert.ok(
    snapshot.triggers.some(
      (row) => row.table === "security_events" && row.trigger === "security_events_snapshot_trg",
    ),
    "the attribution snapshot trigger is missing",
  );
});

test("caller-owned rows that reference a tenant carry a tenant term", () => {
  for (const table of [
    "student_courses",
    "student_mission_progress",
    "study_roadmaps",
    "study_tasks",
  ]) {
    const owning = policiesFor(table).filter((row) => row.cmd === "ALL");
    assert.ok(owning.length > 0, `${table} has no owning policy`);
    for (const row of owning) {
      assert.match(row.check, /current_tenant/, `${table}.${row.policy} has no tenant term in WITH CHECK`);
    }
  }
});

test("the roadmap workflow is tenant-scoped and server-write-only", () => {
  const reads = policiesFor("roadmap_revision_requests").filter((row) => row.cmd === "SELECT");
  assert.ok(reads.length > 0);
  for (const row of reads) {
    assert.match(row.using, /current_school_id/, "roadmap reads are not tenant-scoped");
  }
  const client = snapshot.grants.filter(
    (row) => row.table === "roadmap_revision_requests" && row.grantee !== "service_role",
  );
  for (const row of client) {
    assert.doesNotMatch(row.privileges, /INSERT|UPDATE|DELETE/, `${row.grantee} can write the workflow`);
  }
});

test("no client role can INSERT notifications", () => {
  const client = snapshot.grants.filter(
    (row) => row.table === "user_notifications" && row.grantee !== "service_role",
  );
  for (const row of client) {
    assert.doesNotMatch(row.privileges, /INSERT/, `${row.grantee} can create notifications`);
  }
});
