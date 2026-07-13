import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const migrationsDirectory = new URL("../../supabase/migrations/", import.meta.url);

function studentOwnsRequest({ authUserId, requestStudentId, profiles }) {
  return profiles.some(
    (profile) =>
      profile.id === requestStudentId &&
      profile.auth_user_id === authUserId &&
      profile.role === "student",
  );
}

test("mapped student can insert and select only counseling requests owned by their profile id", () => {
  const profiles = [
    { id: "profile-1", auth_user_id: "auth-1", role: "student" },
    { id: "profile-2", auth_user_id: "auth-2", role: "student" },
  ];

  const ownRequest = { authUserId: "auth-1", requestStudentId: "profile-1", profiles };
  const otherStudentRequest = { authUserId: "auth-1", requestStudentId: "profile-2", profiles };
  const anonymousRequest = { authUserId: null, requestStudentId: "profile-1", profiles };

  assert.equal(studentOwnsRequest(ownRequest), true, "own INSERT/SELECT must be allowed");
  assert.equal(studentOwnsRequest(otherStudentRequest), false, "other-student INSERT/SELECT must be denied");
  assert.equal(studentOwnsRequest(anonymousRequest), false, "anonymous INSERT/SELECT must be denied");
});

test("counseling RLS migration updates only the reviewed authenticated student policies", async () => {
  const names = await readdir(migrationsDirectory);
  const matches = names.filter((name) => name.endsWith("_fix_student_counseling_request_rls.sql"));
  assert.equal(matches.length, 1);

  const sql = await readFile(new URL(`../../supabase/migrations/${matches[0]}`, import.meta.url), "utf8");
  assert.match(sql, /alter policy "users create counseling requests"/i);
  assert.match(sql, /alter policy "users read own counseling requests"/i);
  assert.match(sql, /p\.id\s*=\s*counseling_requests\.student_id/i);
  assert.match(sql, /p\.auth_user_id\s*=\s*\(select auth\.uid\(\)\)/i);
  assert.match(sql, /p\.role\s*=\s*'student'/i);
  assert.match(sql, /p\.profile_id\s*=\s*\(select auth\.uid\(\)\)/i);
  assert.match(sql, /drop policy "demo anon create counseling requests"/i);
  assert.match(sql, /drop policy "demo anon read counseling requests"/i);
  assert.match(sql, /revoke\s+select,\s*insert\s+on\s+public\.counseling_requests\s+from\s+anon/i);
  assert.doesNotMatch(sql, /drop policy "professors update own counseling requests"/i);
  assert.doesNotMatch(sql, /disable row level security|security definer|service_role/i);
});

test("counseling insert failures log structured Supabase diagnostics without changing the public message", async () => {
  const source = await readFile(new URL("./counseling.actions.ts", import.meta.url), "utf8");
  assert.match(source, /console\.error\([^)]*counseling request insert failed/is);
  for (const field of ["code", "message", "details", "hint"]) {
    assert.match(source, new RegExp(`error\\?\\.${field}|error\\.${field}`));
  }
  assert.doesNotMatch(source, /access_token|refresh_token|service_role/i);
  assert.match(source, /student_id:\s*profile\.id/);
  assert.match(source, /\.insert\([\s\S]*?\.select\("id"\)/);
});
