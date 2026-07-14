import type { StudentDifficultyRating } from "@/types/student-weekly-progress";

export const MINIMUM_ANONYMOUS_GROUP_SIZE = 5 as const;

export type ProfessorAnonymousWeeklyAggregateStatus =
  | "not_started"
  | "in_progress"
  | "covered"
  | "needs_review"
  | "skipped";

export type ProfessorAnonymousWeeklyAggregateStatusCounts = {
  [Status in ProfessorAnonymousWeeklyAggregateStatus]: number;
};

export type ProfessorWeeklyDifficultyCounts = {
  [Rating in StudentDifficultyRating]: number;
};

export type ProfessorWeeklyDifficultyPercentages = {
  [Rating in StudentDifficultyRating]: number;
};

export type ProfessorAnonymousWeeklyAggregate = {
  offeringId: string;
  courseName: string;
  weekNumber: number;
  weeklyTitle: string;
  sampleSize: number;
  suppressed: boolean;
  statusCounts: ProfessorAnonymousWeeklyAggregateStatusCounts | null;
  averageDifficulty: number | null;
  averageUnderstanding: number | null;
  difficultyResponseCount: number;
  difficultyCounts: ProfessorWeeklyDifficultyCounts;
  difficultyPercentages: ProfessorWeeklyDifficultyPercentages;
  professorMemos: string[];
};

export type ProfessorAnonymousWeeklyAggregateReport = {
  aggregates: ProfessorAnonymousWeeklyAggregate[];
};

export type ProfessorAnonymousWeeklyAggregateErrorCode =
  | "unauthenticated"
  | "profile_not_found"
  | "forbidden"
  | "permission_denied"
  | "database_read_failed"
  | "invalid_database_row"
  | "invalid_status";

export type ProfessorAnonymousWeeklyAggregateResult =
  | {
      ok: true;
      report: ProfessorAnonymousWeeklyAggregateReport;
    }
  | {
      ok: false;
      error: {
        code: ProfessorAnonymousWeeklyAggregateErrorCode;
        message: string;
      };
    };
