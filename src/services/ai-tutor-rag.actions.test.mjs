import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./ai-tutor-rag.actions.ts", import.meta.url), "utf8");

test("course-grounded tutor reads only enrolled-course knowledge from Supabase", () => {
  assert.match(source, /from\("student_courses"\)/);
  assert.match(source, /from\("syllabi"\)/);
  assert.match(source, /from\("posts"\).*course_notice/s);
  assert.match(source, /from\("faqs"\).*approved_at/s);
  assert.match(source, /from\("curriculum_versions"\)/);
  assert.doesNotMatch(source, /pdfSyllabusMock|localStorage/);
});

test("private professor request records are excluded from tutor retrieval", () => {
  assert.doesNotMatch(source, /from\("escalations"\)/);
  assert.match(source, /sanitizeTutorCitations/);
});
