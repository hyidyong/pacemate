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
const eventTriggerSecurityState = (row) =>
  JSON.stringify({
    name: row.name,
    enabled: row.enabled,
    event: row.event,
    tags: row.tags,
    definition: row.definition,
    definition_md5: row.definition_md5,
    handler_schema: row.handler_schema,
    handler_name: row.handler_name,
    handler_args: row.handler_args,
    handler_identity: row.handler_identity,
    handler_owner: row.handler_owner,
    handler_definition_md5: row.handler_definition_md5,
    handler_security_definer: row.handler_security_definer,
    handler_config: row.handler_config,
    handler_acl: row.handler_acl,
    handler_acl_is_default: row.handler_acl_is_default,
    handler_execute_public: row.handler_execute_public,
    handler_execute_anon: row.handler_execute_anon,
    handler_execute_authenticated: row.handler_execute_authenticated,
    handler_execute_service_role: row.handler_execute_service_role,
  });

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

// ---------------------------------------------------------------------------
// Codex round 5, F4 — a recipient may change READ STATE, and nothing else.
// ---------------------------------------------------------------------------

test("no client role holds table-wide UPDATE on user_notifications", () => {
  // Round 4 fixed WHOSE row is writable. This is WHICH COLUMNS of that row.
  // Measured before the fix: a recipient rewrote title, body, target_href,
  // recipient_role, school_id, category and created_at on their own row.
  const offenders = snapshot.effective_privileges
    .filter((row) => row.table === "user_notifications" && row.role !== "service_role")
    .filter((row) => /UPDATE/.test(row.privileges))
    .map((row) => row.role);
  assert.deepEqual(offenders, [], `table-wide UPDATE still held by: ${offenders.join(", ")}`);
});

test("authenticated holds UPDATE on exactly one notification column: is_read", () => {
  const grants = snapshot.column_privileges.filter(
    (row) => row.table === "user_notifications" && row.grantee === "authenticated" && row.privilege === "UPDATE",
  );
  assert.equal(grants.length, 1, `expected one column-grant row, got ${grants.length}`);
  assert.deepEqual(
    grants[0].columns.split(",").sort(),
    ["is_read"],
    `writable columns: ${grants[0].columns}`,
  );
});

test("the notification row policy still restricts WHICH row, alongside the column grant", () => {
  // Column privileges say WHAT may be written; policies say WHICH ROW. Neither
  // substitutes for the other, so both are asserted.
  const update = snapshot.policies.filter(
    (row) => row.table === "user_notifications" && row.cmd === "UPDATE",
  );
  assert.equal(update.length, 1);
  assert.match(update[0].using, /recipient_id = app_private\.current_profile_id\(\)/);
  assert.match(update[0].check, /recipient_id = app_private\.current_profile_id\(\)/);
});

test("no OTHER table repeats the pattern: server-authored content with table-wide client UPDATE", () => {
  // The sibling audit round 5 asked for, pinned as a fact rather than a note.
  //
  // Every table a client can still UPDATE through a policy is a "users manage
  // own X" surface — rows the user authors and owns end to end, where writing
  // the whole row is the point. user_notifications was the only table whose
  // CONTENT is written by the server and merely acknowledged by the user, and
  // it is now column-scoped.
  //
  // If a new table appears here, someone must decide which of the two it is.
  const policyTables = new Set(
    snapshot.policies.filter((p) => ["UPDATE", "ALL"].includes(p.cmd)).map((p) => p.table),
  );
  const reachable = snapshot.effective_privileges
    .filter((row) => row.role === "authenticated" && /UPDATE/.test(row.privileges))
    .map((row) => row.table)
    .filter((table) => policyTables.has(table))
    .sort();

  assert.deepEqual(reachable, [
    "chat_sessions",
    "comments",
    "professor_availability",
    "professor_question_auto_reply_rules",
    "professor_teaching_slots",
    "roadmap_requests",
    "student_course_schedule_slots",
    "student_courses",
    "student_custom_course_schedule_slots",
    "student_custom_courses",
    "student_mission_progress",
    "student_profiles",
    "study_roadmaps",
    "study_tasks",
  ], "a table gained or lost a client-reachable UPDATE surface — decide whether it is user-authored");

  // And the three already narrowed must stay narrowed.
  for (const table of ["posts", "course_reviews", "user_notifications"]) {
    assert.ok(
      !reachable.includes(table),
      `${table} regained table-wide UPDATE; its provenance columns are writable again`,
    );
  }
});

// ---------------------------------------------------------------------------
// Codex round 5, F9 — what a function created TOMORROW gets.
// ---------------------------------------------------------------------------

test("the snapshot records DEFAULT privileges, not only existing objects", () => {
  // Round 4's guards could only describe functions that already existed. F9 was
  // about the ones that do not yet, so the catalog state that decides their ACL
  // has to be in the snapshot for a drift check to be possible at all.
  assert.ok(Array.isArray(snapshot.default_acls), "default ACLs are missing");
  assert.ok(Array.isArray(snapshot.event_triggers), "event triggers are missing");
  assert.ok(snapshot.default_acls.length > 0);
});

test("no DEFAULT privilege grants to PUBLIC in the schemas this repo owns", () => {
  // PostgreSQL's built-in default for a FUNCTION is EXECUTE TO PUBLIC, and
  // every role inherits PUBLIC — which is why revoking from anon alone did
  // nothing. A PUBLIC entry has an EMPTY grantee, so `grants_public` is
  // computed from the ACL's shape rather than by string-matching "=X", which
  // would also match the owner's own grant.
  const offenders = snapshot.default_acls
    .filter((row) => row.grants_public)
    .map((row) => `${row.owner}/${row.schema}/${row.object_type}`);
  assert.deepEqual(offenders, [], `default ACLs granting PUBLIC: ${offenders.join(", ")}`);
});

test("the future-function event trigger exists, is enabled, and covers both schemas", () => {
  // The default-privileges route alone is not sufficient: a default ACL is
  // keyed on the role that CREATES the object, and this database has more than
  // one such role (pg_default_acl holds separate rows for postgres and
  // supabase_admin). The event trigger does not care who creates the function.
  const trigger = snapshot.event_triggers.find(
    (row) => row.name === "revoke_public_function_execute_trg",
  );
  assert.ok(trigger, "the future-function event trigger is missing");
  assert.notEqual(trigger.enabled, "D", "the event trigger is DISABLED");
  assert.equal(trigger.event, "ddl_command_end");
  assert.deepEqual(trigger.tags.split(",").sort(), ["ALTER FUNCTION", "CREATE FUNCTION"]);
  assert.equal(trigger.handler_schema, "app_private");
  assert.equal(trigger.handler_name, "revoke_public_function_execute");
  assert.equal(trigger.handler_args, "");
  assert.equal(trigger.handler_identity, "app_private.revoke_public_function_execute()");
  assert.equal(typeof trigger.handler_owner, "string");
  assert.ok(trigger.handler_owner.length > 0);
  assert.match(trigger.handler_definition_md5 ?? "", /^[0-9a-f]{32}$/);
  assert.equal(trigger.handler_security_definer, true);
  assert.match(trigger.handler_config, /search_path/);
  assert.equal(typeof trigger.handler_acl, "string");
  assert.equal(typeof trigger.handler_acl_is_default, "boolean");
  for (const role of ["public", "anon", "authenticated", "service_role"]) {
    assert.equal(typeof trigger[`handler_execute_${role}`], "boolean");
  }
  assert.match(trigger.definition ?? "", /app_private\.revoke_public_function_execute\(\)/);
  assert.match(trigger.definition_md5 ?? "", /^[0-9a-f]{32}$/);
});

test("event-trigger handler substitution and security-state drift change the snapshot", () => {
  const trigger = snapshot.event_triggers.find(
    (row) => row.name === "revoke_public_function_execute_trg",
  );
  assert.ok(trigger);
  const baseline = eventTriggerSecurityState(trigger);
  const substitutions = [
    ["handler schema", { handler_schema: "other_schema", handler_identity: "other_schema.revoke_public_function_execute()" }],
    ["handler body", { handler_definition_md5: "0".repeat(32) }],
    ["handler owner", { handler_owner: `${trigger.handler_owner}_other` }],
    ["handler security mode", { handler_security_definer: !trigger.handler_security_definer }],
    ["handler config", { handler_config: "search_path=public" }],
    ["handler ACL", { handler_execute_anon: !trigger.handler_execute_anon }],
    ["disabled trigger", { enabled: "D" }],
    ["event type", { event: "sql_drop" }],
    ["tag filter", { tags: "CREATE FUNCTION" }],
    ["trigger definition", { definition_md5: "f".repeat(32) }],
  ];

  for (const [label, patch] of substitutions) {
    assert.notEqual(
      eventTriggerSecurityState({ ...trigger, ...patch }),
      baseline,
      `${label} substitution was invisible to the snapshot`,
    );
  }
  assert.notEqual(
    JSON.stringify(snapshot.event_triggers.filter((row) => row.name !== trigger.name)),
    JSON.stringify(snapshot.event_triggers),
    "removing the event trigger was invisible to the snapshot",
  );
});

test("the enforcing function is itself SECURITY DEFINER with a pinned search_path", () => {
  // It runs on every CREATE FUNCTION, so a mutable search_path here would be a
  // privilege-escalation vector in the very control meant to prevent one.
  const fn = snapshot.functions.find(
    (row) => row.schema === "app_private" && row.name === "revoke_public_function_execute",
  );
  assert.ok(fn, "the enforcing function is missing from the snapshot");
  assert.equal(fn.security_definer, true);
  assert.match(fn.config, /search_path/);
  assert.equal(fn.execute_anon, false);
  assert.equal(fn.execute_public, false);
});

test("the supabase_admin default still grants anon — which is WHY the trigger exists", () => {
  // Recorded rather than silently relied upon. This row cannot be changed from
  // a migration (we are not a member of supabase_admin), so if a function is
  // ever created under that owner the DEFAULT would hand anon EXECUTE. The
  // event trigger is what makes that harmless, and this test documents the
  // dependency so nobody removes the trigger thinking the defaults suffice.
  const row = snapshot.default_acls.find(
    (entry) => entry.owner === "supabase_admin" && entry.schema === "public" && entry.object_type === "function",
  );
  if (!row) return; // the platform may drop it; that is strictly better.
  assert.match(row.acl, /anon=X/, "if this stops granting anon, simplify the comment above");
});
