import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeUuid } from "@/lib/uuid";
import { resolveAuthenticatedProfile } from "@/services/request-identity.server";
import {
  MINIMUM_ANONYMOUS_GROUP_SIZE,
  type ProfessorAnonymousWeeklyAggregate,
  type ProfessorAnonymousWeeklyAggregateErrorCode,
  type ProfessorAnonymousWeeklyAggregateReport,
  type ProfessorAnonymousWeeklyAggregateResult,
  type ProfessorAnonymousWeeklyAggregateStatus,
  type ProfessorAnonymousWeeklyAggregateStatusCounts,
  type ProfessorWeeklyDifficultyCounts,
} from "@/types/professor-anonymous-weekly-aggregate";
import type { StudentDifficultyRating } from "@/types/student-weekly-progress";

const STUDENT_WEEKLY_PROGRESS_SELECT =
  "student_id, offering_id, week_number, progress_status_override, difficulty_level, understanding_level, difficulty_rating, professor_memo" as const;

const AGGREGATE_STATUSES: readonly ProfessorAnonymousWeeklyAggregateStatus[] = [
  "not_started",
  "in_progress",
  "covered",
  "needs_review",
  "skipped",
];

const SAFE_MESSAGES: Record<ProfessorAnonymousWeeklyAggregateErrorCode, string> = {
  unauthenticated: "A valid Supabase Auth session is required",
  profile_not_found: "The authenticated professor profile could not be found",
  forbidden: "Professor access is required",
  permission_denied: "The anonymous aggregate data could not be read",
  database_read_failed: "The anonymous aggregate data could not be read",
  invalid_database_row: "The anonymous aggregate data is invalid",
  invalid_status: "The anonymous aggregate contains an unsupported status",
};

type UnknownRecord = Record<string, unknown>;

type ParsedProgressRow = {
  studentId: string;
  offeringId: string;
  weekNumber: number;
  status: ProfessorAnonymousWeeklyAggregateStatus;
  difficultyLevel: number | null;
  understandingLevel: number | null;
  difficultyRating: StudentDifficultyRating | null;
  professorMemo: string | null;
};

type ParseProgressRowResult =
  | { ok: true; value: ParsedProgressRow }
  | { ok: false; code: "invalid_database_row" | "invalid_status" };

type MutableAggregate = {
  offeringId: string;
  courseName: string;
  weekNumber: number;
  weeklyTitle: string;
  students: Set<string>;
  statusCounts: ProfessorAnonymousWeeklyAggregateStatusCounts;
  difficultySum: number;
  difficultyCount: number;
  understandingSum: number;
  understandingCount: number;
  difficultyCounts: ProfessorWeeklyDifficultyCounts;
  professorMemos: string[];
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function isAggregateStatus(value: unknown): value is ProfessorAnonymousWeeklyAggregateStatus {
  return typeof value === "string" && AGGREGATE_STATUSES.includes(value as ProfessorAnonymousWeeklyAggregateStatus);
}

function createStatusCounts(): ProfessorAnonymousWeeklyAggregateStatusCounts {
  return {
    not_started: 0,
    in_progress: 0,
    covered: 0,
    needs_review: 0,
    skipped: 0,
  };
}

function createDifficultyCounts(): ProfessorWeeklyDifficultyCounts {
  return { HIGH: 0, MID: 0, LOW: 0 };
}

function isDifficultyRating(value: unknown): value is StudentDifficultyRating {
  return value === "HIGH" || value === "MID" || value === "LOW";
}

function failure(code: ProfessorAnonymousWeeklyAggregateErrorCode): ProfessorAnonymousWeeklyAggregateResult {
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

function parseOffering(value: unknown): { id: string; courseName: string } | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }

  const id = normalizeUuid(value.id);
  const courseValue = Array.isArray(value.course) ? value.course[0] : value.course;
  const courseName = isRecord(courseValue) && typeof courseValue.name === "string"
    ? courseValue.name.trim()
    : "담당 과목";

  return id ? { id, courseName: courseName || "담당 과목" } : null;
}

function parseBoundedInteger(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function parseProgressRow(value: unknown): ParseProgressRowResult {
  if (!isRecord(value)) {
    return { ok: false, code: "invalid_database_row" };
  }

  const studentId = typeof value.student_id === "string" ? normalizeUuid(value.student_id) : null;
  const offeringId = typeof value.offering_id === "string" ? normalizeUuid(value.offering_id) : null;
  const weekNumber = parseBoundedInteger(value.week_number, 1, 60);
  const difficultyLevel =
    value.difficulty_level === null ? null : parseBoundedInteger(value.difficulty_level, 1, 5);
  const understandingLevel =
    value.understanding_level === null ? null : parseBoundedInteger(value.understanding_level, 1, 5);
  const fallbackDifficultyRating = difficultyLevel === null
    ? null
    : difficultyLevel >= 4
      ? "HIGH"
      : difficultyLevel === 3
        ? "MID"
        : "LOW";
  const difficultyRating = value.difficulty_rating === null
    ? fallbackDifficultyRating
    : isDifficultyRating(value.difficulty_rating)
      ? value.difficulty_rating
      : null;
  const professorMemo = typeof value.professor_memo === "string" && value.professor_memo.trim()
    ? value.professor_memo.trim()
    : null;

  if (
    !studentId ||
    !offeringId ||
    weekNumber === null ||
    (value.difficulty_level !== null && difficultyLevel === null) ||
    (value.understanding_level !== null && understandingLevel === null) ||
    (value.difficulty_rating !== null && difficultyRating === null)
  ) {
    return { ok: false, code: "invalid_database_row" };
  }

  if (value.progress_status_override !== null && !isAggregateStatus(value.progress_status_override)) {
    return { ok: false, code: "invalid_status" };
  }

  return {
    ok: true,
    value: {
      studentId,
      offeringId,
      weekNumber,
      status: value.progress_status_override ?? "not_started",
      difficultyLevel,
      understandingLevel,
      difficultyRating,
      professorMemo,
    },
  };
}

function roundToOneDecimal(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function toAggregate(group: MutableAggregate): ProfessorAnonymousWeeklyAggregate {
  const sampleSize = group.students.size;
  const suppressed = sampleSize < MINIMUM_ANONYMOUS_GROUP_SIZE;
  const difficultyResponseCount = Object.values(group.difficultyCounts).reduce((sum, count) => sum + count, 0);
  const toPercentage = (count: number) => difficultyResponseCount === 0
    ? 0
    : Math.round((count / difficultyResponseCount) * 1000) / 10;

  return {
    offeringId: group.offeringId,
    courseName: group.courseName,
    weekNumber: group.weekNumber,
    weeklyTitle: group.weeklyTitle,
    sampleSize,
    suppressed,
    statusCounts: suppressed ? null : group.statusCounts,
    averageDifficulty:
      suppressed || group.difficultyCount === 0
        ? null
        : roundToOneDecimal(group.difficultySum / group.difficultyCount),
    averageUnderstanding:
      suppressed || group.understandingCount === 0
        ? null
        : roundToOneDecimal(group.understandingSum / group.understandingCount),
    difficultyResponseCount: suppressed ? 0 : difficultyResponseCount,
    difficultyCounts: suppressed ? createDifficultyCounts() : group.difficultyCounts,
    difficultyPercentages: suppressed
      ? createDifficultyCounts()
      : {
          HIGH: toPercentage(group.difficultyCounts.HIGH),
          MID: toPercentage(group.difficultyCounts.MID),
          LOW: toPercentage(group.difficultyCounts.LOW),
        },
    professorMemos: group.professorMemos,
  };
}

export async function getProfessorAnonymousWeeklyAggregate(): Promise<ProfessorAnonymousWeeklyAggregateResult> {
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
    .select("id, course:courses(name)")
    .order("id", { ascending: true });

  if (offeringError) {
    return failure(classifyReadError(offeringError));
  }

  const offeringIds: string[] = [];
  const offeringIdSet = new Set<string>();
  const offeringNames = new Map<string, string>();

  for (const rawOffering of (offeringData ?? []) as unknown[]) {
    const offering = parseOffering(rawOffering);
    if (!offering || offeringIdSet.has(offering.id)) {
      return failure("invalid_database_row");
    }

    offeringIds.push(offering.id);
    offeringIdSet.add(offering.id);
    offeringNames.set(offering.id, offering.courseName);
  }

  if (offeringIds.length === 0) {
    return { ok: true, report: { aggregates: [] } };
  }

  // Plans and progress both depend only on offeringIds — one round trip, not two.
  const [
    { data: planData, error: planError },
    { data: progressData, error: progressError },
  ] = await Promise.all([
    supabase
      .from("course_weekly_plans")
      .select("offering_id, week_number, title, topic")
      .in("offering_id", offeringIds),
    supabase
      .from("student_weekly_progress")
      .select(STUDENT_WEEKLY_PROGRESS_SELECT)
      .in("offering_id", offeringIds),
  ]);
  if (planError) {
    return failure(classifyReadError(planError));
  }
  const weeklyTitles = new Map<string, string>();
  for (const rawPlan of (planData ?? []) as unknown[]) {
    if (!isRecord(rawPlan)) continue;
    const planOfferingId = typeof rawPlan.offering_id === "string" ? normalizeUuid(rawPlan.offering_id) : null;
    const planWeekNumber = parseBoundedInteger(rawPlan.week_number, 1, 60);
    if (!planOfferingId || planWeekNumber === null || !offeringIdSet.has(planOfferingId)) continue;
    const title = typeof rawPlan.title === "string" && rawPlan.title.trim()
      ? rawPlan.title.trim()
      : typeof rawPlan.topic === "string" && rawPlan.topic.trim()
        ? rawPlan.topic.trim()
        : `${planWeekNumber}주차`;
    weeklyTitles.set(`${planOfferingId}\u0000${planWeekNumber}`, title);
  }

  if (progressError) {
    return failure(classifyReadError(progressError));
  }

  const groups = new Map<string, MutableAggregate>();
  const seenRows = new Set<string>();

  for (const rawProgress of (progressData ?? []) as unknown[]) {
    const parsed = parseProgressRow(rawProgress);
    if (!parsed.ok) {
      return failure(parsed.code);
    }

    const row = parsed.value;
    if (!offeringIdSet.has(row.offeringId)) {
      return failure("invalid_database_row");
    }

    const rowKey = `${row.offeringId}\u0000${row.studentId}\u0000${row.weekNumber}`;
    if (seenRows.has(rowKey)) {
      return failure("invalid_database_row");
    }
    seenRows.add(rowKey);

    const groupKey = `${row.offeringId}\u0000${row.weekNumber}`;
    const group = groups.get(groupKey) ?? {
      offeringId: row.offeringId,
      courseName: offeringNames.get(row.offeringId) ?? "담당 과목",
      weekNumber: row.weekNumber,
      weeklyTitle: weeklyTitles.get(groupKey) ?? `${row.weekNumber}주차`,
      students: new Set<string>(),
      statusCounts: createStatusCounts(),
      difficultySum: 0,
      difficultyCount: 0,
      understandingSum: 0,
      understandingCount: 0,
      difficultyCounts: createDifficultyCounts(),
      professorMemos: [],
    };

    group.students.add(row.studentId);
    group.statusCounts[row.status] += 1;

    if (row.difficultyLevel !== null) {
      group.difficultySum += row.difficultyLevel;
      group.difficultyCount += 1;
    }

    if (row.understandingLevel !== null) {
      group.understandingSum += row.understandingLevel;
      group.understandingCount += 1;
    }

    if (row.difficultyRating !== null) {
      group.difficultyCounts[row.difficultyRating] += 1;
    }

    if (row.professorMemo !== null) {
      group.professorMemos.push(row.professorMemo);
    }

    groups.set(groupKey, group);
  }

  const aggregates = Array.from(groups.values(), toAggregate).sort((left, right) => {
    if (left.offeringId !== right.offeringId) {
      return left.offeringId < right.offeringId ? -1 : 1;
    }

    return left.weekNumber - right.weekNumber;
  });

  const report: ProfessorAnonymousWeeklyAggregateReport = { aggregates };
  return { ok: true, report };
}
