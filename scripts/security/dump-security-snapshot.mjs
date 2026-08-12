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
  'functions', (
    select coalesce(json_agg(json_build_object(
      'schema', n.nspname, 'name', p.proname, 'args', pg_get_function_identity_arguments(p.oid),
      'security_definer', p.prosecdef,
      'config', coalesce(array_to_string(p.proconfig, ','), ''),
      'acl', coalesce(p.proacl::text, 'DEFAULT')
    ) order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::json)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app_private')
      and p.proname not like 'pgp_%' and p.proname not like 'uuid_%'
  ),
  'triggers', (
    select coalesce(json_agg(json_build_object(
      'table', c.relname, 'trigger', t.tgname
    ) order by c.relname, t.tgname), '[]'::json)
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal
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
    `${live.grants.length} grant rows, ${live.functions.length} functions, ${live.triggers.length} triggers.`,
);
