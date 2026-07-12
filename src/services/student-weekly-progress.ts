import type {
  StudentCourseProgressStatus,
  StudentWeeklyProgressRecord,
  StudentWeeklyProgressStatus,
  StudentWeeklyProgressWeek,
} from "@/types/student-weekly-progress";

type ApprovedWeeklyPlanRow = {
  weekNumber: number;
  title: string | null;
  topic: string | null;
};

export function mergeWeeklyProgressWithPlans(
  plans: readonly ApprovedWeeklyPlanRow[],
  saved: readonly StudentWeeklyProgressRecord[],
): StudentWeeklyProgressWeek[] {
  const savedByWeek = new Map(saved.map((row) => [row.weekNumber, row]));

  return plans.map((plan) => {
    const progress = savedByWeek.get(plan.weekNumber);
    return {
      weekNumber: plan.weekNumber,
      title: plan.title,
      topic: plan.topic,
      progressStatus: progress?.progressStatusOverride ?? "not_started",
      progressStatusOverride: progress?.progressStatusOverride ?? null,
      difficultyLevel: progress?.difficultyLevel ?? null,
      understandingLevel: progress?.understandingLevel ?? null,
      privateNote: progress?.privateNote ?? null,
      sharedFeedback: progress?.sharedFeedback ?? null,
      shareFeedbackWithProfessor: progress?.shareFeedbackWithProfessor ?? false,
    };
  });
}

type ProgressSummaryInput = Pick<
  StudentWeeklyProgressRecord,
  "weekNumber" | "progressStatusOverride"
>;

export function summarizeStudentCourseProgress(
  rows: readonly ProgressSummaryInput[],
): {
  status: StudentCourseProgressStatus;
  lastCompletedWeek: number | null;
  coveredCount: number;
  needsReviewCount: number;
  totalWeekCount: number;
} {
  const covered = rows.filter((row) => row.progressStatusOverride === "covered");
  const needsReviewCount = rows.filter(
    (row) => row.progressStatusOverride === "needs_review",
  ).length;
  const hasActivity = rows.some(
    (row) => row.progressStatusOverride && row.progressStatusOverride !== "not_started",
  );

  return {
    status: needsReviewCount
      ? "needs_review"
      : hasActivity
        ? "in_progress"
        : "not_started",
    lastCompletedWeek: covered.length
      ? Math.max(...covered.map((row) => row.weekNumber))
      : null,
    coveredCount: covered.length,
    needsReviewCount,
    totalWeekCount: rows.length,
  };
}

export function isStudentWeeklyProgressStatus(
  value: string,
): value is StudentWeeklyProgressStatus {
  return [
    "not_started",
    "in_progress",
    "covered",
    "needs_review",
    "skipped",
  ].includes(value);
}
