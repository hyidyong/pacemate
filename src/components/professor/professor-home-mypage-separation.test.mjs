import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
  try {
    return await readFile(new URL(relativePath, import.meta.url), "utf8");
  } catch {
    return "";
  }
}

test("professor home uses a read-only profile summary while professor mypage owns editing", async () => {
  const home = await readSource("../../app/professor/page.tsx");
  const summary = await readSource("./professor-profile-summary.tsx");
  const editor = await readSource("./professor-profile-editor.tsx");
  const mypage = await readSource("../../app/professor/mypage/page.tsx");

  assert.match(home, /ProfessorProfileSummary/);
  assert.doesNotMatch(summary, /<input|<textarea|수정|저장|취소/);
  assert.match(editor, /수정/);
  assert.match(editor, /저장/);
  assert.match(editor, /취소/);
  assert.match(mypage, /ProfessorProfileEditor/);
  assert.doesNotMatch(home, /ProfessorProfileEditor/);
});

test("professor navigation keeps community before the final mypage tab and determines active state precisely", async () => {
  const shell = await readSource("../layout/app-shell.tsx");
  const navigation = await readSource("../layout/professor-mobile-bottom-nav.tsx");

  assert.match(shell, /ProfessorMobileBottomNav/);
  assert.match(navigation, /href:\s*"\/professor\/lounge"[\s\S]*href:\s*"\/professor\/mypage"/);
  assert.match(navigation, /pathname === "\/professor"/);
  assert.match(navigation, /aria-current=\{isActive \? "page" : undefined\}/);
  assert.doesNotMatch(navigation, /startsWith\("\/professor"\)/);
});

test("professor profile save is session-bound and protected by a dedicated RLS policy", async () => {
  const actions = await readSource("../../services/professor.actions.ts");
  const migration = await readSource("../../../supabase/migrations/20260713110000_allow_professor_profile_updates.sql");
  const profileActionStart = actions.indexOf("export async function updateProfessorProfile");
  const profileActionEnd = actions.indexOf("\nexport async function", profileActionStart + 1);
  const profileAction = actions.slice(profileActionStart, profileActionEnd === -1 ? undefined : profileActionEnd);

  assert.match(actions, /export async function updateProfessorProfile/);
  assert.match(profileAction, /createSupabaseServerClient/);
  assert.match(profileAction, /\.eq\("profile_id",\s*profile\.id\)/);
  assert.doesNotMatch(profileAction, /formData\.get\("professorId"\)/);
  assert.match(migration, /create policy "professors update own profile"/i);
  assert.match(migration, /profile\.auth_user_id\s*=\s*\(select auth\.uid\(\)\)/i);
  assert.match(migration, /profile\.role\s*=\s*'professor'/i);
  assert.match(migration, /for update\s+to authenticated/i);
});
