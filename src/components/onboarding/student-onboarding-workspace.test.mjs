import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspaceSource = await readFile("src/components/onboarding/student-onboarding-workspace.tsx", "utf8");
const pageSource = await readFile("src/app/onboarding/page.tsx", "utf8");
const actionsSource = await readFile("src/services/onboarding.actions.ts", "utf8");
const stagedWorkspaceSource = await readFile("src/components/onboarding/electronic-engineering-onboarding-workspace.tsx", "utf8");

test("student onboarding no longer imports the deleted legacy form", () => {
  assert.equal(pageSource.includes("student-onboarding-form"), false);
  assert.equal(pageSource.includes("StudentOnboardingForm"), false);
  assert.equal(workspaceSource.includes("StudentOnboardingForm"), false);
});

test("student onboarding keeps a completion submit path after legacy removal", () => {
  assert.equal(workspaceSource.includes("completeStudentOnboarding"), true);
  assert.equal(workspaceSource.includes("<form"), true);
  assert.equal(actionsSource.includes("export async function completeStudentOnboarding"), true);
  assert.equal(actionsSource.includes("is_onboarded: true"), true);
});

test("student onboarding replaces the legacy profile edit form with staged curriculum selection", () => {
  assert.equal(pageSource.includes("getStudentOnboardingProfile"), false);
  assert.equal(workspaceSource.includes("targetCareer"), false);
  assert.equal(workspaceSource.includes("weakBasics"), false);
  assert.equal(workspaceSource.includes("curriculumPreviews"), true);
  assert.equal(stagedWorkspaceSource.includes("completedCourses"), true);
  assert.equal(actionsSource.includes("completed_courses_text"), true);
});

test("onboarding reveals curriculum input in department, year, semester order", () => {
  assert.match(stagedWorkspaceSource, /selectedMajor/);
  assert.match(stagedWorkspaceSource, /selectedYear/);
  assert.match(stagedWorkspaceSource, /selectedSemester/);
  assert.match(stagedWorkspaceSource, /completedCourseIds/);
  assert.match(stagedWorkspaceSource, /getDefaultCompletedCourseIds/);
  assert.match(stagedWorkspaceSource, /semesterOrder/);
});
