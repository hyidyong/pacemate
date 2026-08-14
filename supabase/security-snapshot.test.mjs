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

// ---------------------------------------------------------------------------
// Codex round 3, F12 — the snapshot must capture what actually changes security
// semantics, not just names.
// ---------------------------------------------------------------------------

test("the snapshot captures effective privileges, not only explicit grants", () => {
  assert.ok(Array.isArray(snapshot.effective_privileges), "effective privileges are missing");
  assert.ok(snapshot.effective_privileges.length > 0);
  assert.ok(Array.isArray(snapshot.public_privileges), "PUBLIC privileges are missing");
  assert.ok(Array.isArray(snapshot.column_privileges), "column privileges are missing");
});

test("nothing is granted to PUBLIC, which every role inherits", () => {
  assert.deepEqual(
    snapshot.public_privileges,
    [],
    `PUBLIC holds privileges every role inherits: ${JSON.stringify(snapshot.public_privileges)}`,
  );
});

test("anon's EFFECTIVE reach is one table, read-only", () => {
  // Explicit grants alone could miss a privilege arriving via PUBLIC or role
  // inheritance; this is computed with has_table_privilege.
  const anon = snapshot.effective_privileges.filter((row) => row.role === "anon");
  assert.deepEqual(
    anon.map((row) => `${row.table}:${row.privileges}`),
    ["schools:SELECT"],
    `anon can effectively reach more than schools: ${JSON.stringify(anon)}`,
  );
});

test("the audit trail is effectively append-only for every client-reachable role", () => {
  for (const row of snapshot.effective_privileges.filter((r) => r.table === "security_events")) {
    assert.doesNotMatch(
      row.privileges,
      /UPDATE|DELETE|TRUNCATE/,
      `${row.role} can effectively mutate the audit trail: ${row.privileges}`,
    );
  }
});

test("provenance columns are not UPDATE-grantable to client roles", () => {
  const forbidden = {
    posts: ["author_id", "school_id", "community_type", "board_key", "course_id"],
    course_reviews: ["author_id", "course_id"],
  };
  for (const [table, columns] of Object.entries(forbidden)) {
    for (const row of snapshot.column_privileges.filter((r) => r.table === table)) {
      const granted = row.columns.split(",");
      for (const column of columns) {
        assert.ok(
          !granted.includes(column),
          `${row.grantee} can UPDATE ${table}.${column} — provenance must be immutable`,
        );
      }
    }
  }
});

test("every function carries a definition hash, so a rewritten body is drift", () => {
  for (const fn of snapshot.functions) {
    assert.match(
      fn.definition_md5 ?? "",
      /^[0-9a-f]{32}$/,
      `${fn.schema}.${fn.name} has no definition hash`,
    );
  }
});

test("the append-only triggers are present, enabled, and hashed", () => {
  const triggers = snapshot.triggers.filter((row) => row.table === "security_events");
  const names = triggers.map((row) => row.trigger);
  assert.ok(names.includes("security_events_no_update_trg"), "the append-only trigger is missing");
  assert.ok(names.includes("security_events_snapshot_trg"), "the attribution trigger is missing");
  for (const trigger of triggers) {
    assert.equal(trigger.enabled, "O", `${trigger.trigger} is not enabled (tgenabled=${trigger.enabled})`);
    assert.match(trigger.definition_md5 ?? "", /^[0-9a-f]{32}$/, `${trigger.trigger} has no hash`);
  }
});

// ---------------------------------------------------------------------------
// Codex round 4, finding 5 — EFFECTIVE function EXECUTE.
//
// The previous snapshot recorded a function's raw `proacl`. When a function is
// created without an explicit revoke, proacl is NULL — which the dump rendered
// as the reassuring string "DEFAULT". PostgreSQL's default for a FUNCTION is
// EXECUTE GRANTED TO PUBLIC, and every role inherits PUBLIC. So the single most
// dangerous regression available — a new SECURITY DEFINER function callable by
// anon — was recorded as "DEFAULT" and no test could see it.
//
// EXECUTE is now computed per role with has_function_privilege.
// ---------------------------------------------------------------------------

test("the snapshot records EFFECTIVE execute privileges, not just the raw ACL", () => {
  assert.ok(snapshot.functions.length > 5);
  for (const fn of snapshot.functions) {
    for (const field of ["execute_public", "execute_anon", "execute_authenticated", "execute_service_role"]) {
      assert.equal(
        typeof fn[field],
        "boolean",
        `${fn.schema}.${fn.name} is missing ${field}; a raw ACL cannot answer this`,
      );
    }
    assert.equal(typeof fn.acl_is_default, "boolean");
  }
});

test("NO function in public or app_private is executable by anon", () => {
  const reachable = snapshot.functions
    .filter((fn) => fn.execute_anon)
    .map((fn) => `${fn.schema}.${fn.name}(${fn.args})`);
  assert.deepEqual(reachable, [], `anon can EXECUTE: ${reachable.join(", ")}`);
});

test("NO function is executable by PUBLIC, which every role inherits", () => {
  // This is the exact regression the raw ACL could not express: a function
  // created without `revoke ... from public` lands here silently.
  const viaPublic = snapshot.functions
    .filter((fn) => fn.execute_public)
    .map((fn) => `${fn.schema}.${fn.name}(${fn.args})`);
  assert.deepEqual(viaPublic, [], `PUBLIC can EXECUTE: ${viaPublic.join(", ")}`);
});

test("no function was left with PostgreSQL's default ACL", () => {
  // acl_is_default means proacl IS NULL, i.e. nobody ever narrowed it. For a
  // function that means PUBLIC EXECUTE. Catching it by shape as well as by
  // effect means a future Postgres default change cannot quietly reopen this.
  const untouched = snapshot.functions
    .filter((fn) => fn.acl_is_default)
    .map((fn) => `${fn.schema}.${fn.name}(${fn.args})`);
  assert.deepEqual(
    untouched,
    [],
    `these functions never had their ACL narrowed: ${untouched.join(", ")}`,
  );
});

test("every SECURITY DEFINER function is reachable only by an authenticated role", () => {
  // A SECURITY DEFINER function runs with the OWNER's privileges, so who may
  // call it is the whole security question.
  for (const fn of snapshot.functions.filter((f) => f.security_definer)) {
    const where = `${fn.schema}.${fn.name}(${fn.args})`;
    assert.equal(fn.execute_anon, false, `${where} is callable by anon`);
    assert.equal(fn.execute_public, false, `${where} is callable via PUBLIC`);
    assert.ok(fn.config.includes("search_path"), `${where} has a mutable search_path`);
  }
});

test("the identity helpers stay callable by authenticated, or every policy breaks", () => {
  // The mirror image: a least-privilege sweep that revokes too much would take
  // RLS down with it, and every policy would deny.
  for (const name of ["current_profile_id", "current_school_id", "current_user_role"]) {
    const fn = snapshot.functions.find((f) => f.schema === "app_private" && f.name === name);
    assert.ok(fn, `missing app_private.${name}`);
    assert.equal(fn.execute_authenticated, true, `authenticated cannot call ${name}; RLS would fail closed`);
  }
});

// ---------------------------------------------------------------------------
// Codex round 4, finding 6 — TRUNCATE is not subject to RLS.
// ---------------------------------------------------------------------------

test("no client role holds TRUNCATE anywhere: it bypasses RLS entirely", () => {
  // TRUNCATE ignores row policies and fires no row triggers, so a client role
  // holding it makes every DELETE policy in the schema decorative. Measured
  // before 20260814180000: authenticated effectively held it on 31 of 54 tables.
  const offenders = snapshot.effective_privileges
    .filter((row) => row.role !== "service_role")
    .filter((row) => /TRUNCATE/.test(row.privileges))
    .map((row) => `${row.role}:${row.table}`);
  assert.deepEqual(offenders, [], `client roles hold TRUNCATE on: ${offenders.join(", ")}`);
});

test("the posts DELETE surface a client keeps is exactly the RLS-governed one", () => {
  // The Data API verbs must survive the least-privilege pass — a sweep that
  // also removes what the app needs is not a fix.
  const authenticated = snapshot.effective_privileges.find(
    (row) => row.table === "posts" && row.role === "authenticated",
  );
  assert.ok(authenticated, "authenticated must still reach posts");
  for (const verb of ["SELECT", "INSERT", "DELETE"]) {
    assert.match(authenticated.privileges, new RegExp(verb), `posts lost ${verb} for authenticated`);
  }
  assert.doesNotMatch(authenticated.privileges, /TRUNCATE/);
});
