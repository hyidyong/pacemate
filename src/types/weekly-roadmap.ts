export type WeeklyProgressStatus =
  | "not_started"
  | "in_progress"
  | "covered"
  | "needs_review"
  | "skipped";

export type CourseProgressStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "needs_review";

export type WeeklyPlanStatus = "draft" | "approved";
export type WeeklyPlanConfidence = "high" | "medium" | "low";
export type WeeklyPlanActivityType = "lecture" | "review" | "discussion" | "assignment" | "assessment";

export interface WeeklyPlanWeek {
  weekNumber: number;
  title: string;
  topics: string[];
  activityType: WeeklyPlanActivityType;
  isAssessment: boolean;
  confidence: WeeklyPlanConfidence;
  sourceNote: string;
}

export interface WeeklyPlanSource {
  type: "syllabus";
  syllabusId: string;
  verifiedByProfessor: boolean;
}

export interface WeeklyPlanDraft {
  status: WeeklyPlanStatus;
  termId: string;
  offeringId: string;
  courseId: string;
  courseName: string;
  professorId: string;
  professorName: string;
  semesterLabel: string;
  source: WeeklyPlanSource;
  weeks: WeeklyPlanWeek[];
  warnings: string[];
}

export interface WeeklyPlanReview extends WeeklyPlanDraft {
  approvalStatus: WeeklyPlanStatus;
  persistedWeekCount: number;
}

export interface WeeklyPlanValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export type PersistedWeeklyPlanApprovalState = {
  review_required: boolean;
  professor_confirmed: boolean;
};

export function deriveWeeklyPlanStatus(
  rows: readonly PersistedWeeklyPlanApprovalState[],
): WeeklyPlanStatus {
  return rows.length === 15 && rows.every(
    (row) => row.review_required === false && row.professor_confirmed === true,
  )
    ? "approved"
    : "draft";
}


export interface AcademicTerm {
  id: string;
  schoolId: string | null;
  semesterLabel: string;
  startsOn: string;
  endsOn: string;
  timezone: string;
  totalWeeks: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CourseOffering {
  id: string;
  courseId: string;
  professorId: string;
  termId: string;
  sectionLabel: string | null;
  startsOn: string | null;
  endsOn: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CourseWeeklyPlan {
  id: string;
  offeringId: string;
  weekNumber: number;
  title: string | null;
  topic: string | null;
  content: string | null;
  learningObjectives: unknown[];
  previewGuide: unknown | null;
  reviewGuide: unknown | null;
  assignmentJson: unknown | null;
  sourceSyllabusId: string | null;
  sourceReference: string | null;
  extractionConfidence: number | null;
  reviewRequired: boolean;
  professorConfirmed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StudentCourseProgress {
  id: string;
  studentId: string;
  offeringId: string;
  lastCompletedWeek: number | null;
  status: CourseProgressStatus;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudentWeeklyProgress {
  id: string;
  studentId: string;
  offeringId: string;
  weekNumber: number;
  progressStatusOverride: WeeklyProgressStatus | null;
  difficultyLevel: number | null;
  understandingLevel: number | null;
  privateNote: string | null;
  sharedFeedback: string | null;
  shareFeedbackWithProfessor: boolean;
  usePrivateNoteForAi: boolean;
  guideJson: unknown | null;
  guideVersion: string | null;
  inputHash: string | null;
  generatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

