import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeUuid } from "@/lib/uuid";
import {
  MINIMUM_ANONYMOUS_GROUP_SIZE,
  type ProfessorAnonymousWeeklyAggregate,
  type ProfessorAnonymousWeeklyAggregateErrorCode,
  type ProfessorAnonymousWeeklyAggregateReport,
  type ProfessorAnonymousWeeklyAggregateResult,
  type ProfessorAnonymousWeeklyAggregateStatus,
  type ProfessorAnonymousWeeklyAggregateStatusCounts,
} from "@/types/professor-anonymous-weekly-aggregate";

const STUDENT_WEEKLY_PROGRESS_SELECT =
  "student_id, offering_id, week_number, progress_status_override, difficulty_level, understanding_level" as const;

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

type ProfileRow = {
  auth_user_id: string | null;
  role: string;
};

type ParsedProgressRow = {
  studentId: string;
  offeringId: string;
  weekNumber: number;
  status: ProfessorAnonymousWeeklyAggregateStatus;
  difficultyLevel: number | null;
  understandingLevel: number | null;
};

type ParseProgressRowResult =
  | { ok: true; value: ParsedProgressRow }
  | { ok: false; code: "invalid_database_row" | "invalid_status" };

type MutableAggregate = {
  offeringId: string;
  weekNumber: number;
  students: Set<string>;
  statusCounts: ProfessorAnonymousWeeklyAggregateStatusCounts;
  difficultySum: number;
  difficultyCount: number;
  understandingSum: number;
  understandingCount: number;
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

function parseProfile(value: unknown): ProfileRow | null {
  if (!isRecord(value)) {
    return null;
  }

  return typeof value.auth_user_id === "string" && typeof value.role === "string"
    ? { auth_user_id: value.auth_user_id, role: value.role }
    : null;
}

function parseOfferingId(value: unknown): string | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }

  return normalizeUuid(value.id);
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

  if (
    !studentId ||
    !offeringId ||
    weekNumber === null ||
    (value.difficulty_level !== null && difficultyLevel === null) ||
    (value.understanding_level !== null && understandingLevel === null)
  ) {
    return { ok: false, code: "invalid_database_row" };
  }

  if (!isAggregateStatus(value.progress_status_override)) {
    return { ok: false, code: "invalid_status" };
  }

  return {
    ok: true,
    value: {
      studentId,
      offeringId,
      weekNumber,
      status: value.progress_status_override,
      difficultyLevel,
      understandingLevel,
    },
  };
}

function roundToOneDecimal(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function toAggregate(group: MutableAggregate): ProfessorAnonymousWeeklyAggregate {
  const sampleSize = group.students.size;
  const suppressed = sampleSize < MINIMUM_ANONYMOUS_GROUP_SIZE;

  return {
    offeringId: group.offeringId,
    weekNumber: group.weekNumber,
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
  };
}

export async function getProfessorAnonymousWeeklyAggregate(): Promise<ProfessorAnonymousWeeklyAggregateResult> {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return failure("database_read_failed");
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return failure("unauthenticated");
  }

  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select("auth_user_id, role")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();

  if (profileError) {
    return failure(classifyReadError(profileError));
  }

  const profile = parseProfile(profileData);
  if (!profile || profile.auth_user_id !== authData.user.id) {
    return failure("profile_not_found");
  }

  if (profile.role !== "professor") {
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
  const offeringIdSet = new Set<string>();

  for (const rawOffering of (offeringData ?? []) as unknown[]) {
    const offeringId = parseOfferingId(rawOffering);
    if (!offeringId || offeringIdSet.has(offeringId)) {
      return failure("invalid_database_row");
    }

    offeringIds.push(offeringId);
    offeringIdSet.add(offeringId);
  }

  if (offeringIds.length === 0) {
    return { ok: true, report: { aggregates: [] } };
  }

  let adminSupabase;
  try {
    adminSupabase = createSupabaseAdminClient();
  } catch {
    return failure("database_read_failed");
  }

  const { data: progressData, error: progressError } = await adminSupabase
    .from("student_weekly_progress")
    .select(STUDENT_WEEKLY_PROGRESS_SELECT)
    .in("offering_id", offeringIds);

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
      weekNumber: row.weekNumber,
      students: new Set<string>(),
      statusCounts: createStatusCounts(),
      difficultySum: 0,
      difficultyCount: 0,
      understandingSum: 0,
      understandingCount: 0,
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
