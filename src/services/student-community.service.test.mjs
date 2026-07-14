import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("student timetable reads use a verified profile and retain RLS-safe fallback", async () => {
  const source = await readFile(new URL("./student-community.service.ts", import.meta.url), "utf8");

  assert.match(source, /getMyCourses\(\s*profile: DemoProfile \| null/);
  assert.match(source, /if \(!profile \|\| profile\.role !== "student"\)\s*\{\s*return \[\];/);
  assert.match(source, /if \(error\?\.code === "42501"\)/);
  assert.match(source, /createSupabaseAdminClient\(\)/);
  assert.match(source, /getMyCourses\(profile\)/);
  assert.match(source, /isMissingTimetableSchema\(error\)/);
  assert.match(source, /selectCourses\(supabase, false\)/);
});
