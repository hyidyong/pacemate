import type { StudentWeeklyProgressStatus } from "@/types/student-weekly-progress";

export type CourseTermCompletionEligibilityStatus =
  | "eligible_for_completion"
  | "needs_review"
  | "still_in_progress"
  | "insufficient_data";

export type ApprovedWeeklyPlanEvidence = {
  week_number: number;
  review_required: boolean;
  professor_confirmed: boolean;
};

export type StudentWeeklyProgressEvidence = {
  week_number: number;
  progress_status_override: StudentWeeklyProgressStatus | null;
};

export type CourseTermCompletionEligibilityEvidence = {
  expectedWeekCount: 15;
  approvedWeekCount: number;
  studentWeekCount: number;
  coveredWeekCount: number;
  needsReviewWeekCount: number;
  inProgressWeekCount: number;
  notStartedWeekCount: number;
  skippedWeekCount: number;
};

export type CourseTermCompletionEligibilityResult = {
  status: CourseTermCompletionEligibilityStatus;
  reasons: string[];
  evidence: CourseTermCompletionEligibilityEvidence;
};

export type CourseTermCompletionEligibilityInput = {
  approvedWeeklyPlan: readonly ApprovedWeeklyPlanEvidence[];
  studentWeeklyProgress: readonly StudentWeeklyProgressEvidence[];
};
