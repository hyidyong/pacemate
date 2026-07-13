import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("anonymous aggregate uses the request-scoped RLS client without service role", async () => {
  const source = await readFile(new URL("./professor-anonymous-weekly-aggregate.server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /createSupabaseAdminClient|supabase\/admin/);
  assert.match(source, /student_weekly_progress/);
  assert.match(source, /difficulty_level, understanding_level/);
});
