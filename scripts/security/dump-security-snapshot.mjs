// Stage 9 (Codex F9) — generate the security snapshot from the LIVE database.
//
// `supabase/schema.sql` cannot serve as the current schema representation: it is
// not executable (a duplicate `day_of_week` column in professor_admin_tasks, a
// `$$$` delimiter typo), it is mojibake-damaged, it declares two tables that do
// not exist, it omits 25 that do, and it still lists policies dropped months
// ago. Stage 9 therefore stopped treating it as a source and read the live
// database directly. This script makes that repeatable and reviewable.
//
// What it emits is deliberately NOT a schema dump — inventing DDL by hand is the
// failure mode the review warns about. It is an inventory of the things a
// security review actually needs to diff: RLS state, policies, grants,
// functions with their security mode and search_path, and triggers.
//
// Migration history remains authoritative. This file is evidence of what the
// migrations produced.
//
// Usage: node scripts/security/dump-security-snapshot.mjs [--check]
//   (no flag)  rewrite supabase/security-snapshot.json
//   --check    exit non-zero if the committed snapshot differs from live

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SNAPSHOT_PATH = fileURLToPath(new URL("../../supabase/security-snapshot.json", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const QUERY = `
select json_build_object(
  'tables', (
    select coalesce(json_agg(json_build_object('table', c.relname, 'rls', c.relrowsecurity) order by c.relname), '[]'::json)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  ),
  'policies', (
    select coalesce(json_agg(json_build_object(
      'table', tablename, 'policy', policyname, 'cmd', cmd,
      'roles', array_to_string(roles, ','), 'using', coalesce(qual, ''), 'check', coalesce(with_check, '')
    ) order by tablename, cmd, policyname), '[]'::json)
    from pg_policies where schemaname = 'public'
  ),
  'grants', (
    select coalesce(json_agg(json_build_object(
      'table', table_name, 'grantee', grantee, 'privileges', privs
    ) order by table_name, grantee), '[]'::json)
    from (
      select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
      from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
      group by table_name, grantee
    ) g
  ),
  -- Codex round 3, F12: the previous snapshot recorded a function's NAME and
  -- flags but not its BODY, and a trigger's name but not what it does. A
  -- rewritten SECURITY DEFINER body or a gutted trigger would have passed
  -- --check unchanged. Both now carry a definition hash.
  -- Codex round 4, finding 5: the raw proacl alone is NOT sufficient, and the
  -- way it fails is the dangerous direction. A function created without an
  -- explicit revoke-from-public has proacl = NULL, which this rendered as the
  -- harmless-looking string DEFAULT — while PostgreSQL's default for a
  -- FUNCTION is EXECUTE GRANTED TO PUBLIC. So a new SECURITY DEFINER function
  -- callable by anon would have appeared in the snapshot as "DEFAULT" and no
  -- test could tell the difference. The effective privilege is now COMPUTED,
  -- per role, with has_function_privilege, so that regression is drift.
  'functions', (
    select coalesce(json_agg(json_build_object(
      'schema', n.nspname, 'name', p.proname, 'args', pg_get_function_identity_arguments(p.oid),
      'security_definer', p.prosecdef,
      'config', coalesce(array_to_string(p.proconfig, ','), ''),
      'acl', coalesce(p.proacl::text, 'DEFAULT'),
      'acl_is_default', p.proacl is null,
      'execute_public', has_function_privilege('public', p.oid, 'EXECUTE'),
      'execute_anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
      'execute_authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'execute_service_role', has_function_privilege('service_role', p.oid, 'EXECUTE'),
      'definition_md5', md5(pg_get_functiondef(p.oid))
    ) order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::json)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app_private')
      and p.proname not like 'pgp_%' and p.proname not like 'uuid_%'
  ),
  'triggers', (
    select coalesce(json_agg(json_build_object(
      'table', c.relname, 'trigger', t.tgname,
      'enabled', t.tgenabled,
      'definition_md5', md5(pg_get_triggerdef(t.oid))
    ) order by c.relname, t.tgname), '[]'::json)
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal
  ),
  -- Effective privileges, including anything reachable through PUBLIC or role
  -- inheritance. Explicit grants alone missed a privilege granted to PUBLIC,
  -- which every role holds.
  'effective_privileges', (
    select coalesce(json_agg(json_build_object(
      'table', tbl, 'role', role_name, 'privileges', privs
    ) order by tbl, role_name), '[]'::json)
    from (
      select c.relname as tbl, r.rolname as role_name,
             string_agg(p.priv, ',' order by p.priv) as privs
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
      cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as p(priv)
      where n.nspname = 'public' and c.relkind = 'r'
        and has_table_privilege(r.rolname, c.oid, p.priv)
      group by c.relname, r.rolname
    ) e
  ),
  -- Privileges held by PUBLIC itself, which every role inherits.
  'public_privileges', (
    select coalesce(json_agg(json_build_object(
      'table', table_name, 'privileges', privs
    ) order by table_name), '[]'::json)
    from (
      select table_name, string_agg(privilege_type, ',' order by privilege_type) as privs
      from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'PUBLIC'
      group by table_name
    ) g
  ),
  -- Column-level privileges: Stage 9 uses these to make provenance immutable,
  -- so a re-grant must show up as drift.
  'column_privileges', (
    select coalesce(json_agg(json_build_object(
      'table', table_name, 'grantee', grantee, 'privilege', privilege_type, 'columns', cols
    ) order by table_name, grantee, privilege_type), '[]'::json)
    from (
      select table_name, grantee, privilege_type,
             string_agg(column_name, ',' order by column_name) as cols
      from information_schema.column_privileges
      where table_schema = 'public'
        and grantee in ('anon', 'authenticated')
        and privilege_type = 'UPDATE'
      group by table_name, grantee, privilege_type
    ) cp
  )
) as snapshot
`;

function fetchLive() {
  // Passed through a file rather than argv: the query contains quotes, commas
  // and parentheses that the CLI's argument parser mangles on Windows.
  const dir = mkdtempSync(join(tmpdir(), "pacemate-snapshot-"));
  const sqlPath = join(dir, "snapshot.sql");
  writeFileSync(sqlPath, QUERY);
  let raw;
  try {
    raw = execFileSync(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["--yes", "supabase@2.114.0", "db", "query", "--linked", "--output-format", "json", "-f", sqlPath],
      { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const start = raw.indexOf("{");
  if (start < 0) throw new Error(`unexpected CLI output: ${raw.slice(0, 200)}`);
  const parsed = JSON.parse(raw.slice(start));
  const snapshot = parsed.rows?.[0]?.snapshot;
  if (!snapshot) throw new Error("no snapshot returned");
  return snapshot;
}

const live = fetchLive();
const serialised = `${JSON.stringify(live, null, 2)}\n`;

if (process.argv.includes("--check")) {
  let committed;
  try {
    committed = readFileSync(SNAPSHOT_PATH, "utf8");
  } catch {
    console.error("No committed snapshot. Run: node scripts/security/dump-security-snapshot.mjs");
    process.exit(1);
  }
  if (committed !== serialised) {
    console.error(
      "DRIFT: supabase/security-snapshot.json does not match the live database.\n" +
        "Either a migration was applied without regenerating it, or the live database\n" +
        "was changed outside the migration chain. Investigate before regenerating.",
    );
    process.exit(1);
  }
  console.log("Security snapshot matches the live database.");
  process.exit(0);
}

writeFileSync(SNAPSHOT_PATH, serialised);
console.log(
  `Wrote supabase/security-snapshot.json — ${live.tables.length} tables, ${live.policies.length} policies, ` +
    `${live.grants.length} grant rows, ${live.effective_privileges.length} effective-privilege rows, ` +
    `${live.public_privileges.length} PUBLIC rows, ${live.column_privileges.length} column-privilege rows, ` +
    `${live.functions.length} functions (hashed), ${live.triggers.length} triggers (hashed).`,
);
