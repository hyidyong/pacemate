import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("professor admin tasks do not grant anonymous or unrestricted write access", async () => {
  const migration = await readFile(
    new URL("../../supabase/migrations/20260714204203_harden_professor_admin_tasks_access.sql", import.meta.url),
    "utf8",
  );
  const actions = await readFile(new URL("./professor.actions.ts", import.meta.url), "utf8");

  assert.match(migration, /revoke all on public\.professor_admin_tasks from anon;/);
  assert.match(migration, /grant select, insert, delete on public\.professor_admin_tasks to authenticated;/);
  assert.doesNotMatch(migration, /using \(true\) with check \(true\)/);
  assert.match(migration, /professors insert own admin tasks/);
  assert.match(migration, /professors delete own admin tasks/);
  assert.match(actions, /const profile = await getDemoProfile\(\);[\s\S]*?profile\?\.role !== "professor"/);
  assert.match(actions, /eq\("profile_id", profile\.id\)/);
});
