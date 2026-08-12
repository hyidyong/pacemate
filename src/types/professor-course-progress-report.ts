export type ProfessorCourseProgressStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "needs_review";

export type ProfessorCourseProgressStatusCounts = {
  [Status in ProfessorCourseProgressStatus]: number;
};

export type ProfessorCourseProgressRow = {
  studentId: string;
  offeringId: string;
  lastCompletedWeek: number | null;
  status: ProfessorCourseProgressStatus;
  lastActivityAt: string | null;
};

export type ProfessorCourseProgressOfferingReport = {
  offeringId: string;
  /** Course display name; null when the offering has no joined course row.
      Students stay anonymous by design — only the course is labeled. */
  courseName: string | null;
  totalStudentCount: number;
  statusCounts: ProfessorCourseProgressStatusCounts;
  students: ProfessorCourseProgressRow[];
};

export type ProfessorCourseProgressReport = {
  offerings: ProfessorCourseProgressOfferingReport[];
};

export type ProfessorCourseProgressReportErrorCode =
  | "unauthenticated"
  | "profile_not_found"
  | "forbidden"
  | "permission_denied"
  | "database_read_failed"
  | "invalid_database_row"
  | "invalid_status";

export type ProfessorCourseProgressReportResult =
  | {
      ok: true;
      report: ProfessorCourseProgressReport;
    }
  | {
      ok: false;
      error: {
        code: ProfessorCourseProgressReportErrorCode;
        message: string;
      };
    };
