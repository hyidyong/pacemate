// Stage 9 migration guards.
//
// The live effect of these migrations is proven by scripts/security/rls-probe.mjs
// against the real database. These tests guard the migration TEXT, so a later
// edit cannot quietly reintroduce the shapes Stage 9 removed — the properties
// below are the ones whose absence was exploitable, verified live before the
// fix (26 failing probe checks) and after (0).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

const helpers = read("20260814000000_stage9_identity_helpers.sql");
const closeAnon = read("20260814010000_stage9_close_anon_surface.sql");
const drift = read("20260814020000_stage9_schema_drift_repair.sql");
const audit = read("20260814030000_stage9_security_events.sql");
const rpc = read("20260814040000_stage9_rpc_authorization.sql");
const postsBackfill = read("20260812070000_tenant_backfill_posts_school.sql");

test("identity helpers live outside the PostgREST-exposed schema", () => {
  assert.match(helpers, /create schema if not exists app_private/);
  assert.match(helpers, /revoke all on schema app_private from public/);
  assert.match(helpers, /grant usage on schema app_private to authenticated, service_role/);
  // KI-011: the SECURITY DEFINER predicates must no longer be RPC endpoints.
  assert.match(helpers, /drop function if exists public\.is_professor_of_offering\(uuid\)/);
  assert.match(helpers, /drop function if exists public\.is_student_of_offering\(uuid\)/);
});

test("every identity helper pins an empty search_path and resolves via auth_user_id", () => {
  const definitions = helpers.split("create or replace function").slice(1);
  assert.ok(definitions.length >= 6, "expected at least six helper definitions");
  for (const definition of definitions) {
    assert.match(definition, /security definer/, "helper is not SECURITY DEFINER");
    assert.match(definition, /set search_path = ''/, "helper has a mutable search_path");
    assert.match(
      definition,
      /auth_user_id = \(select auth\.uid\(\)\)/,
      "helper compares auth.uid() to something other than profiles.auth_user_id",
    );
  }
});

test("no policy predicate equates auth.uid() with a profiles.id column again", () => {
  // This was the defect that made every authenticated policy dead and forced
  // the app onto the anon role. The repaired policies go through
  // app_private.current_profile_id() instead.
  const banned = [
    /\(select auth\.uid\(\)\) = student_id/,
    /\(select auth\.uid\(\)\) = profile_id/,
    /\(select auth\.uid\(\)\) = author_id/,
    /auth\.uid\(\) = id\b/,
  ];
  for (const pattern of banned) {
    assert.doesNotMatch(closeAnon, pattern, `reintroduced a pre-mapping predicate: ${pattern}`);
  }
  assert.match(closeAnon, /app_private\.current_profile_id\(\)/);
});

test("the anon surface is closed by an allowlist, not by remembering to revoke", () => {
  assert.match(closeAnon, /revoke all on public\.%I from anon/);
  assert.match(closeAnon, /and table_name <> 'schools'/);
  assert.match(closeAnon, /alter default privileges in schema public revoke all on tables from anon/);
});

test("the migration asserts its own postconditions and fails closed", () => {
  assert.match(closeAnon, /postcondition failed: anon still has policies/);
  assert.match(closeAnon, /postcondition failed: anon still holds table grants/);
  assert.match(closeAnon, /postcondition failed: demo policies survive/);
  for (const sql of [helpers, closeAnon, drift, audit, rpc]) {
    assert.match(sql, /^begin;/m, "migration is not wrapped in a transaction");
    assert.match(sql, /^commit;/m, "migration is not committed explicitly");
  }
});

test("the notification INSERT path is closed to every client role", () => {
  assert.match(closeAnon, /drop policy if exists "demo create notifications" on public\.user_notifications/);
  assert.match(closeAnon, /revoke insert on public\.user_notifications from authenticated/);
});

test("scheduling data is no longer writable by anyone but its owner", () => {
  assert.match(closeAnon, /drop policy if exists "demo anon manage availability"/);
  assert.match(closeAnon, /drop policy if exists "demo anon manage professor availability"/);
  assert.match(closeAnon, /professors manage own availability/);
  assert.match(closeAnon, /professor_id = app_private\.current_professor_id\(\)/);
});

test("schema drift repair is additive, idempotent, and asserted", () => {
  assert.match(drift, /add column if not exists school_id uuid/);
  for (const column of [
    "board_key",
    "display_mode",
    "anonymous_alias",
    "view_count",
    "is_resolved",
    "resolved_by_post_id",
    "suggested_start",
    "suggested_end",
    "location",
  ]) {
    assert.match(drift, new RegExp(`add column if not exists ${column}\\b`), `missing ${column}`);
  }
  assert.match(drift, /postcondition failed: still missing/);
});

test("posts.school_id is created at its first point of use so the chain can rebuild", () => {
  // Without this the chain aborts at migration 41 of 55 on a fresh database,
  // which is why staging and restore rehearsal were impossible.
  assert.match(
    postsBackfill,
    /alter table public\.posts\s+add column if not exists school_id uuid references public\.schools\(id\)/,
  );
  const addIndex = postsBackfill.indexOf("add column if not exists school_id");
  const assertIndex = postsBackfill.indexOf("posts.school_id backfill incomplete");
  assert.ok(addIndex > -1 && addIndex < assertIndex, "the column must be added before it is asserted on");
});

test("the audit trail cannot be rewritten by anything the browser reaches", () => {
  assert.match(audit, /revoke all on public\.security_events from public, anon, authenticated/);
  assert.match(audit, /grant select on public\.security_events to authenticated/);
  assert.doesNotMatch(audit, /grant (insert|update|delete)[^;]*security_events[^;]*to (anon|authenticated)/);
  assert.match(audit, /for select to authenticated/);
  assert.match(audit, /postcondition failed: a non-SELECT policy exists on the audit trail/);
  // Bounded so the column cannot become an accidental PII sink.
  assert.match(audit, /length\(detail\) <= 200/);
});

test("approve_course_weekly_plan binds the named professor to the caller", () => {
  assert.match(rpc, /caller is not the named professor/);
  assert.match(rpc, /v_caller_professor_id <> p_professor_id/);
  // The pre-existing behaviour must survive the rewrite: the upsert and the
  // student notification are the reason this function exists.
  assert.match(rpc, /insert into public\.course_weekly_plans/);
  assert.match(rpc, /insert into public\.user_notifications/);
  assert.match(rpc, /exactly fifteen weekly plans are required/);
  assert.match(
    rpc,
    /revoke all on function public\.approve_course_weekly_plan\(uuid, uuid, jsonb\) from public, anon, authenticated/,
  );
});
