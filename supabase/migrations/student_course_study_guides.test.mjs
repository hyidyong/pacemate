import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL("./20260714231718_add_student_course_study_guides.sql", import.meta.url);

test("stores strict student course guides without exposing them to browser roles", async () => {
  const source = await readFile(migration, "utf8");

  assert.match(source, /create table public\.student_course_study_guides/);
  assert.match(source, /unique \(student_id, offering_id\)/);
  assert.match(source, /jsonb_typeof\(guide_json\) = 'object'/);
  assert.match(source, /enable row level security/);
  assert.match(source, /revoke all on public\.student_course_study_guides from public, anon, authenticated/);
  assert.match(source, /grant select, insert, update, delete on public\.student_course_study_guides to service_role/);
  assert.match(source, /grantee in \('anon', 'authenticated', 'PUBLIC'\)/);
});
