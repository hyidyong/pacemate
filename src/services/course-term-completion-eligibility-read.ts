import type {
  CourseTermCompletionEligibilityInput,
} from "@/types/course-term-completion-eligibility";
import type { StudentWeeklyProgressStatus } from "@/types/student-weekly-progress";

export const ELIGIBILITY_SELECT = {
  term: "id, semester_label",
  offering: "id, course_id, term_id",
  weeklyPlan: "offering_id, week_number, review_required, professor_confirmed",
  weeklyProgress: "student_id, offering_id, week_number, progress_status_override",
} as const;

export type EligibilityWeeklyPlanRow = {
  offering_id: string;
  week_number: number;
  review_required: boolean;
  professor_confirmed: boolean;
};

export type EligibilityWeeklyProgressRow = {
  student_id: string;
  offering_id: string;
  week_number: number;
  progress_status_override: string | null;
};

export function mapCourseTermCompletionEligibilityInput({
  plans,
  progress,
}: {
  plans: readonly EligibilityWeeklyPlanRow[];
  progress: readonly EligibilityWeeklyProgressRow[];
}): CourseTermCompletionEligibilityInput {
  return {
    approvedWeeklyPlan: plans.map((plan) => ({
      week_number: plan.week_number,
      review_required: plan.review_required,
      professor_confirmed: plan.professor_confirmed,
    })),
    studentWeeklyProgress: progress.map((row) => ({
      week_number: row.week_number,
      // Preserve null and unknown database values so the pure function can
      // fail closed instead of this read layer guessing a status.
      progress_status_override: row.progress_status_override as StudentWeeklyProgressStatus | null,
    })),
  };
}
