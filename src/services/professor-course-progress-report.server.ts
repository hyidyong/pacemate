import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeUuid } from "@/lib/uuid";
import { resolveAuthenticatedProfile } from "@/services/request-identity.server";
import type {
  ProfessorCourseProgressOfferingReport,
  ProfessorCourseProgressReportErrorCode,
  ProfessorCourseProgressReportResult,
  ProfessorCourseProgressRow,
  ProfessorCourseProgressStatus,
  ProfessorCourseProgressStatusCounts,
} from "@/types/professor-course-progress-report";

const COURSE_PROGRESS_SELECT =
  "student_id, offering_id, last_completed_week, status, last_activity_at" as const;

const PROGRESS_STATUSES: readonly ProfessorCourseProgressStatus[] = [
  "not_started",
  "in_progress",
  "completed",
  "needs_review",
];

const SAFE_MESSAGES: Record<ProfessorCourseProgressReportErrorCode, string> = {
  unauthenticated: "A valid Supabase Auth session is required",
  profile_not_found: "The authenticated professor profile could not be found",
  forbidden: "Professor access is required",
  permission_denied: "The professor report data could not be read",
  database_read_failed: "The professor report data could not be read",
  invalid_database_row: "The professor report data is invalid",
  invalid_status: "The professor report contains an unsupported progress status",
};

type UnknownRecord = Record<string, unknown>;

type ParsedProgressRow = {
  row: ProfessorCourseProgressRow;
};

type ParseProgressRowResult =
  | { ok: true; value: ParsedProgressRow }
  | { ok: false; code: "invalid_database_row" | "invalid_status" };

type MutableOfferingReport = ProfessorCourseProgressOfferingReport;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function isProgressStatus(value: unknown): value is ProfessorCourseProgressStatus {
  return typeof value === "string" && PROGRESS_STATUSES.includes(value as ProfessorCourseProgressStatus);
}

function createStatusCounts(): ProfessorCourseProgressStatusCounts {
  return {
    not_started: 0,
    in_progress: 0,
    completed: 0,
    needs_review: 0,
  };
}

function failure(code: ProfessorCourseProgressReportErrorCode): ProfessorCourseProgressReportResult {
  return {
    ok: false,
    error: {
      code,
      message: SAFE_MESSAGES[code],
    },
  };
}

function classifyReadError(error: unknown): "permission_denied" | "database_read_failed" {
  if (!isRecord(error)) {
    return "database_read_failed";
  }

  const code = typeof error.code === "string" ? error.code : null;
  const status = typeof error.status === "number" ? error.status : null;

  return code === "42501" || status === 401 || status === 403
    ? "permission_denied"
    : "database_read_failed";
}

function parseOfferingId(value: unknown): string | null {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
    return null;
  }

  return normalizeUuid(value.id);
}

function parseProgressRow(value: unknown): ParseProgressRowResult {
  if (!isRecord(value)) {
    return { ok: false, code: "invalid_database_row" };
  }

  const studentId = value.student_id;
  const offeringId = value.offering_id;
  const lastCompletedWeek = value.last_completed_week;
  const lastActivityAt = value.last_activity_at;
  const normalizedStudentId = typeof studentId === "string" ? normalizeUuid(studentId) : null;
  const normalizedOfferingId = typeof offeringId === "string" ? normalizeUuid(offeringId) : null;

  if (
    !normalizedStudentId ||
    !normalizedOfferingId ||
    (lastCompletedWeek !== null &&
      (typeof lastCompletedWeek !== "number" ||
        !Number.isInteger(lastCompletedWeek) ||
        lastCompletedWeek < 0 ||
        lastCompletedWeek > 60)) ||
    (lastActivityAt !== null &&
      (typeof lastActivityAt !== "string" || Number.isNaN(Date.parse(lastActivityAt))))
  ) {
    return { ok: false, code: "invalid_database_row" };
  }

  if (!isProgressStatus(value.status)) {
    return { ok: false, code: "invalid_status" };
  }

  return {
    ok: true,
    value: {
      row: {
        studentId: normalizedStudentId,
        offeringId: normalizedOfferingId,
        lastCompletedWeek,
        status: value.status,
        lastActivityAt,
      },
    },
  };
}

function sortStudents(students: ProfessorCourseProgressRow[]): void {
  students.sort((left, right) => {
    if (left.lastCompletedWeek === null && right.lastCompletedWeek !== null) return 1;
    if (left.lastCompletedWeek !== null && right.lastCompletedWeek === null) return -1;

    if (
      left.lastCompletedWeek !== null &&
      right.lastCompletedWeek !== null &&
      left.lastCompletedWeek !== right.lastCompletedWeek
    ) {
      return right.lastCompletedWeek - left.lastCompletedWeek;
    }

    return left.studentId < right.studentId ? -1 : left.studentId > right.studentId ? 1 : 0;
  });
}

export async function getProfessorCourseProgressReport(): Promise<ProfessorCourseProgressReportResult> {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return failure("database_read_failed");
  }

  const identity = await resolveAuthenticatedProfile();
  if (identity.status === "client_error") {
    return failure("database_read_failed");
  }
  if (identity.status === "unauthenticated") {
    return failure("unauthenticated");
  }
  if (identity.status === "profile_error") {
    return failure(classifyReadError(identity.error));
  }
  if (identity.status === "profile_missing" || identity.status === "profile_mismatch") {
    return failure("profile_not_found");
  }

  if (identity.profile.role !== "professor") {
    return failure("forbidden");
  }

  const { data: offeringData, error: offeringError } = await supabase
    .from("course_offerings")
    .select("id")
    .order("id", { ascending: true });

  if (offeringError) {
    return failure(classifyReadError(offeringError));
  }

  const offeringIds: string[] = [];
  const reports = new Map<string, MutableOfferingReport>();

  for (const rawOffering of (offeringData ?? []) as unknown[]) {
    const offeringId = parseOfferingId(rawOffering);
    if (!offeringId || reports.has(offeringId)) {
      return failure("invalid_database_row");
    }

    offeringIds.push(offeringId);
    reports.set(offeringId, {
      offeringId,
      totalStudentCount: 0,
      statusCounts: createStatusCounts(),
      students: [],
    });
  }

  if (offeringIds.length === 0) {
    return { ok: true, report: { offerings: [] } };
  }

  const { data: progressData, error: progressError } = await supabase
    .from("student_course_progress")
    .select(COURSE_PROGRESS_SELECT)
    .in("offering_id", offeringIds);

  if (progressError) {
    return failure(classifyReadError(progressError));
  }

  const seenStudents = new Set<string>();

  for (const rawProgress of (progressData ?? []) as unknown[]) {
    const parsed = parseProgressRow(rawProgress);
    if (!parsed.ok) {
      return failure(parsed.code);
    }

    const { row } = parsed.value;
    const report = reports.get(row.offeringId);
    if (!report) {
      return failure("database_read_failed");
    }

    const studentKey = `${row.offeringId}\u0000${row.studentId}`;
    if (seenStudents.has(studentKey)) {
      return failure("invalid_database_row");
    }

    seenStudents.add(studentKey);
    report.totalStudentCount += 1;
    report.statusCounts[row.status] += 1;
    report.students.push(row);
  }

  for (const report of reports.values()) {
    sortStudents(report.students);
  }

  return {
    ok: true,
    report: {
      offerings: offeringIds.map((offeringId) => reports.get(offeringId) as MutableOfferingReport),
    },
  };
}
