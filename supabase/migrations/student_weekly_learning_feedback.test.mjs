import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL("./20260714223924_add_student_weekly_learning_feedback.sql", import.meta.url);

test("extends the canonical weekly progress table without exposing personal notes", async () => {
  const source = await readFile(migration, "utf8");

  assert.match(source, /alter table public\.student_weekly_progress/);
  assert.match(source, /difficulty_rating text/);
  assert.match(source, /professor_memo text/);
  assert.match(source, /check \(difficulty_rating is null or difficulty_rating in \('HIGH', 'MID', 'LOW'\)\)/);
  assert.match(source, /student_weekly_progress_offering_feedback_idx/);
  assert.match(source, /grant select \(difficulty_rating, professor_memo, updated_at\)/);
  assert.doesNotMatch(source, /grant select \([^)]*private_note/is);
  assert.match(source, /has_column_privilege\('authenticated', 'public\.student_weekly_progress', 'private_note', 'SELECT'\)/);
  assert.match(source, /professors read own weekly feedback plan labels/);
});
