import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("weekly plan editor removes internal metadata and exposes inline editing controls", async () => {
  const source = await readFile(new URL("./weekly-plan-review-editor.tsx", import.meta.url), "utf8");
  assert.match(source, /주간 계획 최종 승인/);
  assert.match(source, /aria-label=\{`\$\{week\.weekNumber\}주차 수정`\}/);
  assert.match(source, /onChange=\{\(event\) =>/);
  assert.doesNotMatch(source, /review_required|professor_confirmed|sourceNote|High|Medium|Low/);
  assert.doesNotMatch(source, /border(?:-[a-z]+)?/);
});

test("weekly plan preview page uses the clean review editor and user-facing copy", async () => {
  const source = await readFile(new URL("../../app/professor/weekly-plan-preview/page.tsx", import.meta.url), "utf8");
  assert.match(source, /WeeklyPlanReviewEditor/);
  assert.match(source, /교수 승인 전 초안입니다/);
  assert.doesNotMatch(source, /review_required|professor_confirmed|course_weekly_plans|근거|High|Medium|Low/);
  assert.doesNotMatch(source, /border(?:-[a-z]+)?/);
});

test("approval action accepts validated edited week payloads", async () => {
  const source = await readFile(new URL("../../services/weekly-plan-approval.actions.ts", import.meta.url), "utf8");
  assert.match(source, /editedWeeks/);
  assert.match(source, /title\.length > 200/);
  assert.match(source, /content\.length > 4000/);
  assert.match(source, /editedWeek\.content/);
});
