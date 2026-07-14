import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const migrationsDirectory = new URL("../../supabase/migrations/", import.meta.url);

function canAccessCommunity({ authUserId, communityType, profiles }) {
  return profiles.some(
    (profile) =>
      profile.auth_user_id === authUserId &&
      ((profile.role === "student" && communityType === "student") ||
        (profile.role === "professor" && communityType === "professor")),
  );
}

test("student and professor identities cannot cross community boundaries", () => {
  const profiles = [
    { id: "student-profile", auth_user_id: "student-auth", role: "student" },
    { id: "professor-profile", auth_user_id: "professor-auth", role: "professor" },
  ];

  assert.equal(canAccessCommunity({ authUserId: "student-auth", communityType: "student", profiles }), true);
  assert.equal(canAccessCommunity({ authUserId: "student-auth", communityType: "professor", profiles }), false);
  assert.equal(canAccessCommunity({ authUserId: "professor-auth", communityType: "professor", profiles }), true);
  assert.equal(canAccessCommunity({ authUserId: "professor-auth", communityType: "student", profiles }), false);
  assert.equal(canAccessCommunity({ authUserId: null, communityType: "student", profiles }), false);
});

test("community services filter in the database and server actions derive type from the session role", async () => {
  const studentService = await readFile(new URL("./student-community.service.ts", import.meta.url), "utf8");
  const professorService = await readFile(new URL("./professor-community.service.ts", import.meta.url), "utf8");
  const studentActions = await readFile(new URL("./student-community.actions.ts", import.meta.url), "utf8");
  const professorActions = await readFile(new URL("./professor-community.actions.ts", import.meta.url), "utf8");

  assert.match(studentService, /\.eq\("community_type",\s*"student"\)/);
  assert.match(professorService, /\.eq\("community_type",\s*"professor"\)/);
  assert.match(studentActions, /community_type:\s*"student"/);
  assert.match(professorActions, /community_type:\s*"professor"/);
  assert.doesNotMatch(`${studentActions}\n${professorActions}`, /formData\.get\("community_type"\)/);
  assert.match(`${studentActions}\n${professorActions}`, /createSupabaseServerClient/);
});

test("community migration separates posts and all linked interaction policies", async () => {
  const names = await readdir(migrationsDirectory);
  const matches = names.filter((name) => name.endsWith("_separate_student_professor_communities.sql"));
  assert.equal(matches.length, 1);
  const sql = await readFile(new URL(`../../supabase/migrations/${matches[0]}`, import.meta.url), "utf8");

  assert.match(sql, /add column(?: if not exists)? community_type text/i);
  assert.match(sql, /check \(community_type in \('student', 'professor'\)\)/i);
  assert.match(sql, /update public\.posts[\s\S]*p\.role = 'student'/i);
  assert.match(sql, /update public\.posts[\s\S]*p\.role = 'professor'/i);
  assert.match(sql, /create index posts_community_type_status_created_idx/i);
  for (const table of ["posts", "comments", "post_reactions", "reports"]) {
    assert.match(sql, new RegExp(`on public\\.${table}`, "i"));
  }
  assert.match(sql, /comments\.post_id[\s\S]*posts\.community_type/i);
  assert.match(sql, /post_reactions\.post_id[\s\S]*posts\.community_type/i);
  assert.match(sql, /p\.auth_user_id\s*=\s*\(select auth\.uid\(\)\)/i);
  assert.match(sql, /revoke select, insert, update, delete[\s\S]*from anon/i);
  assert.doesNotMatch(sql, /security definer|disable row level security|using\s*\(true\)|with check\s*\(true\)/i);
});
