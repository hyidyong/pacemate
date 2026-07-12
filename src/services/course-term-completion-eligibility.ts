import type {
  CourseTermCompletionEligibilityEvidence,
  CourseTermCompletionEligibilityInput,
  CourseTermCompletionEligibilityResult,
} from "@/types/course-term-completion-eligibility";
import type { StudentWeeklyProgressStatus } from "@/types/student-weekly-progress";

const EXPECTED_WEEK_COUNT = 15;
const EXPECTED_WEEKS = new Set(
  Array.from({ length: EXPECTED_WEEK_COUNT }, (_, index) => index + 1),
);
const KNOWN_STATUSES = new Set<StudentWeeklyProgressStatus>([
  "not_started",
  "in_progress",
  "covered",
  "needs_review",
  "skipped",
]);

function hasExactWeekSet(rows: readonly { week_number: number }[]) {
  return (
    rows.length === EXPECTED_WEEK_COUNT &&
    new Set(rows.map((row) => row.week_number)).size === EXPECTED_WEEK_COUNT &&
    rows.every((row) => EXPECTED_WEEKS.has(row.week_number))
  );
}

function emptyEvidence(): CourseTermCompletionEligibilityEvidence {
  return {
    expectedWeekCount: EXPECTED_WEEK_COUNT,
    approvedWeekCount: 0,
    studentWeekCount: 0,
    coveredWeekCount: 0,
    needsReviewWeekCount: 0,
    inProgressWeekCount: 0,
    notStartedWeekCount: 0,
    skippedWeekCount: 0,
  };
}

function insufficientData(
  reasons: string[],
  evidence: CourseTermCompletionEligibilityEvidence,
): CourseTermCompletionEligibilityResult {
  return { status: "insufficient_data", reasons, evidence };
}

export function assessCourseTermCompletionEligibility({
  approvedWeeklyPlan,
  studentWeeklyProgress,
}: CourseTermCompletionEligibilityInput): CourseTermCompletionEligibilityResult {
  const evidence = emptyEvidence();
  evidence.approvedWeekCount = approvedWeeklyPlan.filter(
    (week) => !week.review_required && week.professor_confirmed,
  ).length;
  evidence.studentWeekCount = studentWeeklyProgress.length;

  if (approvedWeeklyPlan.length !== EXPECTED_WEEK_COUNT) {
    return insufficientData(["approved_weekly_plan_count_incomplete"], evidence);
  }

  if (!hasExactWeekSet(approvedWeeklyPlan)) {
    return insufficientData(["approved_weekly_plan_weeks_invalid"], evidence);
  }

  if (approvedWeeklyPlan.some((week) => week.review_required || !week.professor_confirmed)) {
    return insufficientData(["approved_weekly_plan_not_approved"], evidence);
  }

  if (studentWeeklyProgress.length !== EXPECTED_WEEK_COUNT) {
    return insufficientData(["student_weekly_progress_count_incomplete"], evidence);
  }

  if (!hasExactWeekSet(studentWeeklyProgress)) {
    return insufficientData(["student_weekly_progress_weeks_invalid"], evidence);
  }

  const unknownStatus = studentWeeklyProgress.some(
    (week) =>
      week.progress_status_override === null ||
      !KNOWN_STATUSES.has(week.progress_status_override),
  );
  if (unknownStatus) {
    return insufficientData(["student_weekly_progress_status_unknown"], evidence);
  }

  for (const week of studentWeeklyProgress) {
    switch (week.progress_status_override) {
      case "covered":
        evidence.coveredWeekCount += 1;
        break;
      case "needs_review":
        evidence.needsReviewWeekCount += 1;
        break;
      case "in_progress":
        evidence.inProgressWeekCount += 1;
        break;
      case "not_started":
        evidence.notStartedWeekCount += 1;
        break;
      case "skipped":
        evidence.skippedWeekCount += 1;
        break;
    }
  }

  if (evidence.needsReviewWeekCount > 0 || evidence.skippedWeekCount > 0) {
    return {
      status: "needs_review",
      reasons: [
        ...(evidence.needsReviewWeekCount > 0 ? ["needs_review_status_present"] : []),
        ...(evidence.skippedWeekCount > 0 ? ["skipped_status_present"] : []),
      ],
      evidence,
    };
  }

  if (evidence.coveredWeekCount === EXPECTED_WEEK_COUNT) {
    return {
      status: "eligible_for_completion",
      reasons: ["all_approved_weeks_covered"],
      evidence,
    };
  }

  return {
    status: "still_in_progress",
    reasons: ["approved_weeks_not_all_covered"],
    evidence,
  };
}
