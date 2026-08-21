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

const tenantWrites = read("20260814050000_stage9_tenant_correlated_writes.sql");

test("caller-owned rows that reference a tenant resource carry a tenant term", () => {
  // Ownership alone ("is this row mine?") is true of an enrolment in another
  // university's course. Every one of these was live-exploitable via direct
  // PostgREST before this migration.
  for (const table of [
    "students manage own student courses",
    "students manage own mission progress",
    "students manage own study roadmaps",
    "students manage own study tasks",
  ]) {
    const policy = tenantWrites.slice(tenantWrites.indexOf(`create policy "${table}"`));
    assert.ok(policy.length > 0, `missing policy: ${table}`);
    const body = policy.slice(0, policy.indexOf(";"));
    assert.match(body, /course_in_current_tenant\(course_id\)/, `${table} lacks a course tenant term`);
  }
  assert.match(tenantWrites, /offering_in_current_tenant\(offering_id\)/);
});

test("a study task cannot hang off someone else's roadmap", () => {
  assert.match(
    tenantWrites,
    /roadmap_id is null\s*or exists \([\s\S]*?study_roadmaps r[\s\S]*?r\.student_id = app_private\.current_profile_id\(\)/,
  );
});

test("community writes are tenant-scoped without losing the role/community rule", () => {
  for (const marker of [
    /create policy "users create posts"[\s\S]*?school_id = app_private\.current_school_id\(\)/,
    /create policy "users create comments"[\s\S]*?po\.school_id = app_private\.current_school_id\(\)/,
    /create policy "users create own community reactions"[\s\S]*?po\.school_id = app_private\.current_school_id\(\)/,
  ]) {
    assert.match(tenantWrites, marker);
  }
  // The Stage 6 role<->community pairing must survive the rewrite.
  assert.match(tenantWrites, /current_user_role\(\) = 'student' and community_type = 'student'/);
  assert.match(tenantWrites, /current_user_role\(\) = 'professor' and community_type = 'professor'/);
});

test("the tenant predicates are SECURITY DEFINER with an empty search_path and no anon EXECUTE", () => {
  for (const fn of ["course_in_current_tenant", "offering_in_current_tenant"]) {
    const definition = tenantWrites.slice(
      tenantWrites.indexOf(`create or replace function app_private.${fn}`),
    );
    const body = definition.slice(0, definition.indexOf("$$;"));
    assert.match(body, /security definer/, `${fn} is not SECURITY DEFINER`);
    assert.match(body, /set search_path = ''/, `${fn} has a mutable search_path`);
  }
  assert.match(tenantWrites, /revoke all on function app_private\.course_in_current_tenant\(uuid\) from public, anon/);
  assert.match(tenantWrites, /revoke all on function app_private\.offering_in_current_tenant\(uuid\) from public, anon/);
});

test("the migration proves it is closing a hole rather than hiding rows", () => {
  assert.match(tenantWrites, /precondition failed: % cross-tenant student_courses row\(s\) already exist/);
  assert.match(tenantWrites, /precondition failed: % cross-tenant posts row\(s\) already exist/);
  assert.match(tenantWrites, /postcondition failed: policy without a tenant term/);
});

const counselingBoundary = read("20260814060000_stage9_counseling_write_boundary.sql");

test("counseling mutations are server-only, so Stage 5's transition engine is not bypassable", () => {
  assert.match(counselingBoundary, /drop policy if exists "professors update own counseling requests"/);
  assert.match(counselingBoundary, /revoke update, delete on public\.counseling_requests from authenticated/);
  assert.match(counselingBoundary, /revoke update, delete on public\.counseling_requests from anon/);
  // The legitimate paths must survive: students still book, participants still read.
  assert.match(counselingBoundary, /grant select, insert on public\.counseling_requests to authenticated/);
  assert.match(counselingBoundary, /grant select, insert, update, delete on public\.counseling_requests to service_role/);
  assert.match(counselingBoundary, /postcondition failed: a client role can still mutate counseling rows/);
  assert.match(counselingBoundary, /postcondition failed: an UPDATE\/DELETE policy survives/);
  assert.match(counselingBoundary, /postcondition failed: authenticated lost SELECT/);
  assert.match(counselingBoundary, /postcondition failed: service_role cannot perform the server-side transition/);
});

test("the Stage 5 transition rules are not duplicated into RLS", () => {
  // Two implementations of the same rule drift apart. The DB boundary removes
  // the bypass; it does not restate the matrix. Comments describe the RED
  // evidence and legitimately name the statuses, so compare the SQL only.
  const sqlOnly = counselingBoundary
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  assert.doesNotMatch(sqlOnly, /'approved'|'rejected'|'cancelled'|'pending'/);
});

const roadmapScope = read("20260814070000_stage9_roadmap_tenant_scope.sql");

test("the roadmap revision workflow has an authoritative tenant", () => {
  assert.match(roadmapScope, /add column if not exists school_id uuid references public\.schools\(id\)/);
  assert.match(roadmapScope, /alter column school_id set not null/);
  // Backfill must be provable, not hopeful.
  assert.match(roadmapScope, /precondition failed: % roadmap_revision_requests row\(s\) have no resolvable tenant/);
  assert.match(roadmapScope, /postcondition failed: unscoped roadmap revision rows remain/);
});

test("roadmap reads are tenant-scoped and writes stay server-only", () => {
  assert.match(roadmapScope, /create policy "tenant reads its own roadmap revision requests"[\s\S]*?school_id = app_private\.current_school_id\(\)/);
  assert.match(roadmapScope, /revoke insert, update, delete on public\.roadmap_revision_requests from authenticated, anon/);
  assert.match(roadmapScope, /grant select, insert, update, delete on public\.roadmap_revision_requests to service_role/);
  assert.match(roadmapScope, /postcondition failed: a client role can write the workflow/);
  assert.match(roadmapScope, /postcondition failed: service_role cannot run the approval/);
});

test("approval is constrained by tenant, not by role alone", async () => {
  const { readFileSync } = await import("node:fs");
  const action = readFileSync(
    new URL("../../src/services/admin-approval.actions.ts", import.meta.url),
    "utf8",
  );
  // The service-role update predicate must carry school_id, so a leaked or
  // guessed UUID from another tenant cannot be approved.
  assert.match(action, /\.eq\("id", requestId\)\s*\n\s*\.eq\("school_id", profile\.school_id\)/);
});

test("the professor direct-edit path writes through the service role with a tenant", async () => {
  const { readFileSync } = await import("node:fs");
  const actions = readFileSync(
    new URL("../../src/services/professor.actions.ts", import.meta.url),
    "utf8",
  );
  // Stage 9 revoked authenticated INSERT here, which silently broke this action.
  const selfApprove = actions.slice(actions.indexOf('status: "approved",'));
  assert.match(selfApprove.slice(0, 400), /school_id: profile\.school_id/);
  assert.doesNotMatch(
    actions,
    /const supabase = await createSupabaseServerClient\(\);\s*\n\s*const \{ data, error \} = await supabase\s*\n\s*\.from\("roadmap_revision_requests"\)/,
    "the roadmap revision insert must not use the session client",
  );
});

const auditAcls = read("20260814080000_stage9_audit_durability_and_acls.sql");
const auditDetach = read("20260814090000_stage9_audit_detach_foreign_keys.sql");

test("privileged ACLs are explicit, never incidental defaults", () => {
  // Live inspection showed service_role held its audit-table and RPC privileges
  // only through Supabase's default grants; a rebuild elsewhere could differ.
  assert.match(auditAcls, /revoke all on public\.security_events from public, anon, authenticated/);
  assert.match(auditAcls, /grant select on public\.security_events to authenticated/);
  assert.match(auditAcls, /grant select, insert, delete on public\.security_events to service_role/);
  assert.match(auditAcls, /grant execute on function public\.approve_course_weekly_plan\(uuid, uuid, jsonb\) to service_role/);
  // UPDATE is granted to nobody.
  assert.doesNotMatch(auditAcls, /grant[^;]*update[^;]*on public\.security_events/i);
});

test("ACL postconditions verify required access AND forbidden access", () => {
  for (const positive of [
    /postcondition failed: service_role cannot write the audit trail/,
    /postcondition failed: service_role cannot read the audit trail/,
    /postcondition failed: tenant admins cannot read the audit trail/,
    /postcondition failed: service_role cannot execute the approval RPC/,
  ]) {
    assert.match(auditAcls, positive);
  }
  for (const negative of [
    /postcondition failed: forbidden audit privileges/,
    /postcondition failed: an ordinary user can mutate the audit trail/,
    /postcondition failed: a client role can execute the approval RPC/,
  ]) {
    assert.match(auditAcls, negative);
  }
});

test("audit attribution is an immutable snapshot, not a nullable pointer", () => {
  assert.match(auditAcls, /add column if not exists actor_ref text/);
  assert.match(auditAcls, /add column if not exists school_ref text/);
  assert.match(auditAcls, /add column if not exists actor_role_ref text/);
  // Populated by a trigger, so a caller cannot forget it.
  assert.match(auditAcls, /create trigger security_events_snapshot_trg\s*\n\s*before insert on public\.security_events/);
  // Append-only enforced by the database, not by convention.
  assert.match(auditAcls, /create trigger security_events_no_update_trg\s*\n\s*before update on public\.security_events/);
});

test("the audit trail cannot block or be damaged by deleting the actor", () => {
  // The append-only trigger initially rejected the ON DELETE SET NULL cascade,
  // which turned the audit trail into a lock on user deletion — worse than the
  // original defect, and directly in the way of the erasure path still owed.
  assert.match(auditDetach, /drop constraint if exists security_events_actor_profile_id_fkey/);
  assert.match(auditDetach, /drop constraint if exists security_events_school_id_fkey/);
  assert.match(auditDetach, /postcondition failed: foreign keys survive on the audit table/);
  // The migration proves the property with a self-test rather than asserting it.
  assert.match(auditDetach, /insert into public\.profiles[\s\S]*?delete from public\.profiles where id = v_profile/);
  assert.match(auditDetach, /postcondition failed: the attribution snapshot did not survive actor deletion/);
  assert.match(auditDetach, /postcondition failed: the audit row was mutated by the actor deletion/);
});

test("the SSO audit write is awaited, not fire-and-forget", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../../src/lib/sso/sso-audit.ts", import.meta.url), "utf8");
  assert.match(source, /export async function emitSsoAuditEvent/);
  assert.match(source, /await recordSecurityEvent\(/);
  assert.doesNotMatch(source, /void recordSecurityEvent\(/, "a durable write must not be fire-and-forget");
});
