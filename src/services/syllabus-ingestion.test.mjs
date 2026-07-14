import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL("../../supabase/migrations/20260714220000_syllabus_storage_and_study_data.sql", import.meta.url);
const service = new URL("./syllabus-ingestion.service.ts", import.meta.url);

test("stores syllabus files in Supabase-backed storage metadata without local file paths", async () => {
  const sql = await readFile(migration, "utf8");
  const source = await readFile(service, "utf8");

  assert.match(sql, /alter table public\.syllabi/);
  assert.match(sql, /storage_path text/);
  assert.match(sql, /parsed_data jsonb/);
  assert.match(source, /createSupabaseAdminClient/);
  assert.match(source, /from\("syllabi"\)/);
  assert.doesNotMatch(source, /writeFile|mkdir|tmp|localStorage/);
});

test("uses bounded, indexed normalized task fields for roadmap persistence", async () => {
  const sql = await readFile(migration, "utf8");

  assert.match(sql, /create table if not exists public\.study_roadmaps/);
  assert.match(sql, /create table if not exists public\.study_tasks/);
  assert.match(sql, /study_tasks_student_due_idx/);
  assert.match(sql, /students manage own study tasks/);
});

test("does not persist timetable records in browser storage", async () => {
  const source = await readFile(new URL("../lib/student-timetable.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /localStorage|STUDENT_TIMETABLE_STORAGE_KEY|STUDENT_TIMETABLE_UPDATED_EVENT/);
  assert.match(source, /setCourses\(initialSnapshot\)/);
});

test("parsing is server-only and persists extracted content through the ingestion service", async () => {
  const source = await readFile(service, "utf8");

  assert.match(source, /import "server-only"/);
  assert.match(source, /storage[\s\S]*download/);
  assert.match(source, /rawExtractedText/);
  assert.match(source, /course_schedules/);
  assert.match(source, /course_assessments/);
  assert.doesNotMatch(source, /localStorage/);
});

test("professor parsing action verifies syllabus ownership and course offering", async () => {
  const source = await readFile(new URL("./syllabus-ingestion.actions.ts", import.meta.url), "utf8");

  assert.match(source, /uploaded_by.*profile\.id/);
  assert.match(source, /\.eq\("course_id", syllabus\.course_id\)/);
  assert.match(source, /\.eq\("professor_id", professor\.id\)/);
});
