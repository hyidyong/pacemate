import type { StudentCourseStudyGuideView } from "@/types/student-course-study-guide";

export type StudentWeeklyProgressStatus =
  | "not_started"
  | "in_progress"
  | "covered"
  | "needs_review"
  | "skipped";

export type StudentCourseProgressStatus =
  | "not_started"
  | "in_progress"
  | "needs_review";

export type StudentDifficultyRating = "HIGH" | "MID" | "LOW";

export type StudentWeeklyFeedbackDraft = {
  weekNumber: number;
  difficultyRating: StudentDifficultyRating | null;
  personalMemo: string;
  professorMemo: string;
  updatedAt: string | null;
};

export type StudentRoadmapCourseGuide = StudentCourseStudyGuideView;

export type StudentWeeklyProgressRecord = {
  weekNumber: number;
  progressStatusOverride: StudentWeeklyProgressStatus | null;
  difficultyLevel: number | null;
  understandingLevel: number | null;
  privateNote: string | null;
  sharedFeedback: string | null;
  shareFeedbackWithProfessor: boolean;
};

export type StudentWeeklyProgressWeek = StudentWeeklyProgressRecord & {
  title: string | null;
  topic: string | null;
  progressStatus: StudentWeeklyProgressStatus;
};

export type StudentCourseProgressSummary = {
  status: StudentCourseProgressStatus;
  lastCompletedWeek: number | null;
  coveredCount: number;
  needsReviewCount: number;
  totalWeekCount: number;
};

export type StudentWeeklyProgressPreview = {
  courseName: string;
  semesterLabel: string;
  offeringId: string;
  weeks: StudentWeeklyProgressWeek[];
  summary: StudentCourseProgressSummary;
};
