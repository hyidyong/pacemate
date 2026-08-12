import "server-only";

import { assessCourseTermCompletionEligibility } from "@/services/course-term-completion-eligibility";
import {
  ELIGIBILITY_SELECT,
  mapCourseTermCompletionEligibilityInput,
  type EligibilityWeeklyPlanRow,
  type EligibilityWeeklyProgressRow,
} from "@/services/course-term-completion-eligibility-read";
import type { CourseTermCompletionEligibilityResult } from "@/types/course-term-completion-eligibility";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeUuid } from "@/lib/uuid";
import { resolveAuthenticatedProfile } from "@/services/request-identity.server";

export type CourseTermCompletionEligibilityReadErrorCode =
  | "invalid_offering_id"
  | "unauthenticated"
  | "profile_not_found"
  | "forbidden"
  | "offering_not_found"
  | "term_not_found"
  | "permission_denied"
  | "database_read_failed";

export type CourseTermCompletionEligibilityReadResult =
  | {
      ok: true;
      offeringId: string;
      courseId: string;
      termId: string;
      semesterLabel: string;
      eligibility: CourseTermCompletionEligibilityResult;
    }
  | {
      ok: false;
      error: {
        code: CourseTermCompletionEligibilityReadErrorCode;
        message: string;
      };
    };

type EligibilityProfileRow = {
  id: string;
  auth_user_id: string | null;
  role: string;
};

type EligibilityOfferingRow = {
  id: string;
  course_id: string;
  term_id: string;
};

type EligibilityTermRow = {
  id: string;
  semester_label: string;
};

const safeMessages: Record<CourseTermCompletionEligibilityReadErrorCode, string> = {
  invalid_offering_id: "A valid course offering is required",
  unauthenticated: "A valid Supabase Auth session is required",
  profile_not_found: "The authenticated profile could not be found",
  forbidden: "Student eligibility data is available to students only",
  offering_not_found: "The requested offering is unavailable for this student",
  term_not_found: "The academic term could not be found",
  permission_denied: "The requested eligibility data could not be read",
  database_read_failed: "Eligibility data could not be read",
};

function failure(
  code: CourseTermCompletionEligibilityReadErrorCode,
): CourseTermCompletionEligibilityReadResult {
  return {
    ok: false,
    error: {
      code,
      message: safeMessages[code],
    },
  };
}

function classifyReadError(
  error: { code?: string; status?: number },
): CourseTermCompletionEligibilityReadErrorCode {
  return error.code === "42501" || error.status === 401 || error.status === 403
    ? "permission_denied"
    : "database_read_failed";
}

export async function getCourseTermCompletionEligibility(
  offeringId: string,
): Promise<CourseTermCompletionEligibilityReadResult> {
  const normalizedOfferingId = normalizeUuid(offeringId);
  if (!normalizedOfferingId) {
    return failure("invalid_offering_id");
  }

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

  const profileRow = identity.profile as EligibilityProfileRow;

  if (profileRow.role !== "student") {
    return failure("forbidden");
  }

  // Ownership gate: the offering must belong to this student's own courses.
  // This app-side check replaces the student RLS policy on course_offerings,
  // which currently fails with 42P17 (its subquery on student_weekly_progress
  // meets the professor policy that subqueries course_offerings back).
  // limit(1): student_courses is unique on (student_id, course_id, status), so
  // the same offering can be owned via several rows — existence is enough here.
  const { data: ownedOffering, error: ownedOfferingError } = await supabase
    .from("student_courses")
    .select("offering_id")
    .eq("student_id", profileRow.id)
    .eq("offering_id", normalizedOfferingId)
    .limit(1)
    .maybeSingle();

  if (ownedOfferingError) {
    return failure(classifyReadError(ownedOfferingError));
  }

  if (!ownedOffering) {
    return failure("offering_not_found");
  }

  // Recursion-affected tables are read with the server-only admin client,
  // scoped to the verified student id and owned offering id.
  const admin = createSupabaseAdminClient();
  const { data: offering, error: offeringError } = await admin
    .from("course_offerings")
    .select(ELIGIBILITY_SELECT.offering)
    .eq("id", normalizedOfferingId)
    .maybeSingle();

  if (offeringError) {
    return failure(classifyReadError(offeringError));
  }

  if (!offering) {
    return failure("offering_not_found");
  }

  const offeringRow = offering as EligibilityOfferingRow;
  const { data: term, error: termError } = await admin
    .from("academic_terms")
    .select(ELIGIBILITY_SELECT.term)
    .eq("id", offeringRow.term_id)
    .maybeSingle();

  if (termError) {
    return failure(classifyReadError(termError));
  }

  if (!term) {
    return failure("term_not_found");
  }

  const [plansResult, progressResult] = await Promise.all([
    admin
      .from("course_weekly_plans")
      .select(ELIGIBILITY_SELECT.weeklyPlan)
      .eq("offering_id", offeringRow.id)
      .order("week_number", { ascending: true }),
    admin
      .from("student_weekly_progress")
      .select(ELIGIBILITY_SELECT.weeklyProgress)
      .eq("student_id", profileRow.id)
      .eq("offering_id", offeringRow.id)
      .order("week_number", { ascending: true }),
  ]);

  if (plansResult.error) {
    return failure(classifyReadError(plansResult.error));
  }

  if (progressResult.error) {
    return failure(classifyReadError(progressResult.error));
  }

  const input = mapCourseTermCompletionEligibilityInput({
    plans: (plansResult.data ?? []) as EligibilityWeeklyPlanRow[],
    progress: (progressResult.data ?? []) as EligibilityWeeklyProgressRow[],
  });

  return {
    ok: true,
    offeringId: offeringRow.id,
    courseId: offeringRow.course_id,
    termId: (term as EligibilityTermRow).id,
    semesterLabel: (term as EligibilityTermRow).semester_label,
    eligibility: assessCourseTermCompletionEligibility(input),
  };
}
