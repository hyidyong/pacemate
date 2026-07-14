import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const roadmapServer = new URL("../../services/personalized-weekly-roadmap.server.ts", import.meta.url);
const studentCommunityActions = new URL("../../services/student-community.actions.ts", import.meta.url);

test("keeps the selected timetable offering in the roadmap URL", async () => {
  const source = await readFile(new URL("./student-roadmap-workspace.tsx", import.meta.url), "utf8");

  assert.match(source, /router\.push\(nextOfferingId \? `\/roadmap\?offering=\$\{encodeURIComponent\(nextOfferingId\)\}` : "\/roadmap"\)/);
});

test("shows completed week controls with the completed style before the active style", async () => {
  const source = await readFile(new URL("./student-roadmap-workspace.tsx", import.meta.url), "utf8");
  const completedMatch = /completed\s*\?\s*"bg-green-50 text-green-600 shadow-sm"/.exec(source);
  const activeMatch = /number === activeWeek\s*\?\s*"bg-blue-50 text-blue-600 shadow-sm"/.exec(source);
  const completedIndex = completedMatch?.index ?? -1;
  const activeIndex = activeMatch?.index ?? -1;

  assert.ok(completedIndex >= 0, "completed state style is missing");
  assert.ok(activeIndex >= 0, "active state style is missing");
  assert.ok(completedIndex < activeIndex, "completed state must take priority over active state");
});

test("renders a bottom regeneration control only after a roadmap exists", async () => {
  const source = await readFile(new URL("./student-roadmap-workspace.tsx", import.meta.url), "utf8");

  assert.match(source, /hasPersonalizedRoadmap: boolean/);
  assert.match(source, /hasPersonalizedRoadmap \? \(/);
  assert.match(source, /시간표나 온보딩 정보가 바뀌었나요\?/);
  assert.match(source, /로드맵 다시 생성하기/);
  assert.match(source, /onClick=\{generateRoadmap\}/);
});

test("repairs timetable course rows that do not yet have an offering id", async () => {
  const source = await readFile(roadmapServer, "utf8");

  assert.match(source, /select\("id, offering_id, course_id, semester_label, course:courses\(name\)"\)/);
  assert.match(source, /resolveMissingTimetableOfferings/);
  assert.match(source, /update\(\{ offering_id: offeringId \}\)/);
  assert.match(source, /const reconciledEnrollments = await resolveMissingTimetableOfferings/);
  assert.match(source, /from\("course_professors"\)/);
  assert.match(source, /from\("course_offerings"\)\.insert/);
});

test("accepts duplicate timetable rows when authorizing a selected offering", async () => {
  const source = await readFile(roadmapServer, "utf8");

  assert.match(source, /const profile = await getStudentProfile\(\)/);
  assert.match(source, /select\("id"\)\s*\.eq\("student_id", profile\.id\)\s*\.eq\("offering_id", offeringId\)\s*\.limit\(1\)\s*\.maybeSingle\(\)/);
});

test("starts with the roadmap course placeholder instead of auto-selecting a timetable course", async () => {
  const source = await readFile(new URL("./student-roadmap-workspace.tsx", import.meta.url), "utf8");
  const serverSource = await readFile(roadmapServer, "utf8");

  assert.match(source, /<option disabled value="">.*과목을 선택/);
  assert.match(source, /disabled=\{isPending \|\| !selectedOfferingId\}/);
  assert.match(serverSource, /const selectedOfferingId = offerings\.some\(\(offering\) => offering\.offeringId === requestedOfferingId\)\s*\? requestedOfferingId!\s*:\s*""/);
});

test("persists timetable changes through the server-only admin client", async () => {
  const source = await readFile(studentCommunityActions, "utf8");

  assert.match(source, /import \{ createSupabaseAdminClient \} from "@\/lib\/supabase\/admin"/);
  assert.match(source, /function createStudentCommunitySupabaseClient\(\)/);
  assert.match(source, /const supabase = createStudentCommunitySupabaseClient\(\)/);
});

test("does not report roadmap generation as successful when approved syllabus rows are missing", async () => {
  const serverSource = await readFile(roadmapServer, "utf8");
  const actionSource = await readFile(new URL("../../services/student-roadmap.actions.ts", import.meta.url), "utf8");

  assert.match(serverSource, /if \(!\(plansResult\.data \?\? \[\]\)\.length\) \{\s*throw new Error\("Approved weekly syllabus is unavailable"\);\s*\}/);
  assert.match(actionSource, /Approved weekly syllabus is unavailable/);
});

test("falls back to weekly progress storage when roadmap migrations are not deployed", async () => {
  const source = await readFile(roadmapServer, "utf8");

  assert.match(source, /error\?\.code === "PGRST205"/);
  assert.match(source, /from\("student_weekly_progress"\)\s*\.upsert/);
  assert.match(source, /guide_json/);
});
