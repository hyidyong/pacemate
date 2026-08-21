// Post-Stage-10 UX restoration — the current week number is shown inside a
// circular indicator on the weekly-missions card.
//
// The value is the existing `currentWeek` prop (student_courses.current_week,
// passed from the dashboard); the component must display it, not derive it.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentPath = new URL("./weekly-missions.tsx", import.meta.url);
const dashboardPath = new URL("../../app/dashboard/page.tsx", import.meta.url);

test("renders the current week number inside a circular, labelled indicator", async () => {
  const source = await readFile(componentPath, "utf8");

  // One element carries the testid, a circular shape, an accessible label that
  // names it as the CURRENT week, and the raw prop as its content.
  const indicator = /<span[^>]*data-testid="current-week-indicator"[^>]*>[\s\S]*?<\/span>/.exec(source);
  assert.ok(indicator, "current-week-indicator element is missing");
  const markup = indicator[0];
  assert.match(markup, /rounded-full/, "indicator is not circular");
  assert.match(markup, /aria-label=\{`현재 \$\{currentWeek\}주차`\}/, "indicator is not identified as the current week");
  assert.match(markup, /\{currentWeek\}\s*<\/span>/, "indicator must render the currentWeek prop verbatim");
  // Equal width and height keep the shape a circle, not a pill.
  assert.match(markup, /\bh-10\b[^"]*\bw-10\b|\bw-10\b[^"]*\bh-10\b/);
  assert.match(markup, /shrink-0/, "indicator must not squash on narrow screens");
});

test("currentWeek is displayed, not recomputed", async () => {
  const source = await readFile(componentPath, "utf8");

  assert.match(source, /currentWeek: number/);
  assert.doesNotMatch(source, /new Date\(|Date\.now\(|getWeek|differenceInWeeks|Math\.(floor|ceil|round)\(/);
  assert.doesNotMatch(source, /currentWeek\s*[-+*/]\s*\d|\d\s*[-+*/]\s*currentWeek/);
  // The actions still receive the same prop value the indicator shows.
  assert.match(source, /generateWeeklyGuide\(courseId, studentId, currentWeek\)/);
  assert.match(source, /submitProgressFeedback\(courseId, studentId, currentWeek, feedback\)/);
});

test("the surrounding weekly mission content is intact", async () => {
  const source = await readFile(componentPath, "utf8");

  assert.match(source, /주차별 맞춤 예습\/복습 가이드/);
  assert.match(source, /아직 이번 주차 가이드가 생성되지 않았습니다\./);
  assert.match(source, /AI 가이드 생성하기/);
  assert.match(source, /예상 진도:/);
  assert.match(source, /예습 및 복습 가이드:/);
  assert.match(source, /실제 학교 진도가 다른가요\?/);
  assert.match(source, /피드백 반영하기/);
  assert.match(source, /router\.refresh\(\)/);
});

test("the dashboard still feeds student_courses.current_week straight into the component", async () => {
  const source = await readFile(dashboardPath, "utf8");

  assert.match(source, /currentWeek: sc\.current_week,/);
  assert.match(source, /currentWeek=\{c\.currentWeek\}/);
});
