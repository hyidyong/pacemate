import assert from "node:assert/strict";
import test from "node:test";
import { assessCourseTermCompletionEligibility } from "./course-term-completion-eligibility.ts";

const approvedPlan = Array.from({ length: 15 }, (_, index) => ({
  week_number: index + 1,
  review_required: false,
  professor_confirmed: true,
}));

function weeklyRows(statuses) {
  return statuses.map((progress_status_override, index) => ({
    week_number: index + 1,
    progress_status_override,
  }));
}

const covered = Array.from({ length: 15 }, () => "covered");

test("returns eligible_for_completion only when all approved 15 weeks are covered", () => {
  const result = assessCourseTermCompletionEligibility({
    approvedWeeklyPlan: approvedPlan,
    studentWeeklyProgress: weeklyRows(covered),
  });

  assert.equal(result.status, "eligible_for_completion");
});

test("returns needs_review when any week needs review", () => {
  const statuses = [...covered];
  statuses[4] = "needs_review";

  assert.equal(
    assessCourseTermCompletionEligibility({
      approvedWeeklyPlan: approvedPlan,
      studentWeeklyProgress: weeklyRows(statuses),
    }).status,
    "needs_review",
  );
});

test("returns still_in_progress for in-progress or not-started weeks", () => {
  const statuses = [...covered];
  statuses[8] = "in_progress";
  statuses[9] = "not_started";

  assert.equal(
    assessCourseTermCompletionEligibility({
      approvedWeeklyPlan: approvedPlan,
      studentWeeklyProgress: weeklyRows(statuses),
    }).status,
    "still_in_progress",
  );
});

test("returns insufficient_data when the plan is missing a week", () => {
  assert.equal(
    assessCourseTermCompletionEligibility({
      approvedWeeklyPlan: approvedPlan.slice(0, 14),
      studentWeeklyProgress: weeklyRows(covered),
    }).status,
    "insufficient_data",
  );
});

test("returns insufficient_data when the plan has a duplicate week", () => {
  const duplicatePlan = approvedPlan.map((week) => ({ ...week }));
  duplicatePlan[14].week_number = 14;

  assert.equal(
    assessCourseTermCompletionEligibility({
      approvedWeeklyPlan: duplicatePlan,
      studentWeeklyProgress: weeklyRows(covered),
    }).status,
    "insufficient_data",
  );
});

test("returns insufficient_data when a plan week is not approved", () => {
  const unapprovedPlan = approvedPlan.map((week, index) =>
    index === 7 ? { ...week, professor_confirmed: false } : week,
  );

  assert.equal(
    assessCourseTermCompletionEligibility({
      approvedWeeklyPlan: unapprovedPlan,
      studentWeeklyProgress: weeklyRows(covered),
    }).status,
    "insufficient_data",
  );
});

test("returns insufficient_data when student progress rows are missing", () => {
  assert.equal(
    assessCourseTermCompletionEligibility({
      approvedWeeklyPlan: approvedPlan,
      studentWeeklyProgress: weeklyRows(covered.slice(0, 14)),
    }).status,
    "insufficient_data",
  );
});

test("returns insufficient_data when student weeks are duplicated", () => {
  const duplicateProgress = weeklyRows(covered);
  duplicateProgress[14].week_number = 14;

  assert.equal(
    assessCourseTermCompletionEligibility({
      approvedWeeklyPlan: approvedPlan,
      studentWeeklyProgress: duplicateProgress,
    }).status,
    "insufficient_data",
  );
});

test("fails closed for an unknown status", () => {
  const statuses = [...covered];
  statuses[2] = "unknown_status";

  assert.equal(
    assessCourseTermCompletionEligibility({
      approvedWeeklyPlan: approvedPlan,
      studentWeeklyProgress: weeklyRows(statuses),
    }).status,
    "insufficient_data",
  );
});

test("does not require student_course_progress to make the evidence decision", () => {
  const result = assessCourseTermCompletionEligibility({
    approvedWeeklyPlan: approvedPlan,
    studentWeeklyProgress: weeklyRows(covered),
  });

  assert.equal(result.status, "eligible_for_completion");
  assert.equal("courseProgress" in result, false);
});
