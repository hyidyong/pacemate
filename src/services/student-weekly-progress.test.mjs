import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeWeeklyProgressWithPlans,
  summarizeStudentCourseProgress,
} from "./student-weekly-progress.ts";

const plans = [
  { weekNumber: 1, title: "회사의 개념", topic: "회사의 개념" },
  { weekNumber: 2, title: "주주의 지위", topic: "주주의 지위" },
];

test("merges saved progress without changing the approved plan rows", () => {
  const saved = [
    {
      weekNumber: 2,
      progressStatusOverride: "covered",
      difficultyLevel: 3,
      understandingLevel: 4,
      privateNote: "복습 필요",
      sharedFeedback: "질문이 있어요",
      shareFeedbackWithProfessor: false,
    },
  ];

  const merged = mergeWeeklyProgressWithPlans(plans, saved);

  assert.deepEqual(merged, [
    {
      weekNumber: 1,
      title: "회사의 개념",
      topic: "회사의 개념",
      progressStatus: "not_started",
      progressStatusOverride: null,
      difficultyLevel: null,
      understandingLevel: null,
      privateNote: null,
      sharedFeedback: null,
      shareFeedbackWithProfessor: false,
    },
    {
      weekNumber: 2,
      title: "주주의 지위",
      topic: "주주의 지위",
      progressStatus: "covered",
      progressStatusOverride: "covered",
      difficultyLevel: 3,
      understandingLevel: 4,
      privateNote: "복습 필요",
      sharedFeedback: "질문이 있어요",
      shareFeedbackWithProfessor: false,
    },
  ]);
  assert.deepEqual(plans, [
    { weekNumber: 1, title: "회사의 개념", topic: "회사의 개념" },
    { weekNumber: 2, title: "주주의 지위", topic: "주주의 지위" },
  ]);
});

test("summarizes course progress without treating it as graduation eligibility", () => {
  assert.deepEqual(summarizeStudentCourseProgress([]), {
    status: "not_started",
    lastCompletedWeek: null,
    coveredCount: 0,
    needsReviewCount: 0,
    totalWeekCount: 0,
  });
  assert.deepEqual(
    summarizeStudentCourseProgress([
      { weekNumber: 1, progressStatusOverride: "covered" },
      { weekNumber: 2, progressStatusOverride: "skipped" },
    ]),
    {
      status: "in_progress",
      lastCompletedWeek: 1,
      coveredCount: 1,
      needsReviewCount: 0,
      totalWeekCount: 2,
    },
  );
  assert.deepEqual(
    summarizeStudentCourseProgress([
      { weekNumber: 1, progressStatusOverride: "needs_review" },
    ]),
    {
      status: "needs_review",
      lastCompletedWeek: null,
      coveredCount: 0,
      needsReviewCount: 1,
      totalWeekCount: 1,
    },
  );
});
