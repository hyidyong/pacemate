import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveAuthenticatedProfile } from "@/services/request-identity.server";
import {
  selectCompanyLawOffering,
  type CompanyLawOfferingRow,
} from "@/services/company-law-offering";
import type {
  CourseTermCompletionEligibilityReadErrorCode,
} from "@/services/course-term-completion-eligibility.server";

export type CompanyLawOfferingResolution =
  | {
      ok: true;
      offeringId: string;
      courseName: string;
      semesterLabel: string;
    }
  | {
      ok: false;
      error: {
        code: CourseTermCompletionEligibilityReadErrorCode;
        message: string;
      };
    };

const messages: Record<CourseTermCompletionEligibilityReadErrorCode, string> = {
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
): CompanyLawOfferingResolution {
  return { ok: false, error: { code, message: messages[code] } };
}

function classifyError(error: { code?: string; status?: number }) {
  return error.code === "42501" || error.status === 401 || error.status === 403
    ? ("permission_denied" as const)
    : ("database_read_failed" as const);
}

export async function resolveCompanyLaw2026OfferingForSession(): Promise<CompanyLawOfferingResolution> {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return failure("database_read_failed");
  }

  const identity = await resolveAuthenticatedProfile();
  if (identity.status === "client_error") return failure("database_read_failed");
  if (identity.status === "unauthenticated") return failure("unauthenticated");
  if (identity.status === "profile_error") return failure(classifyError(identity.error));
  if (identity.status === "profile_missing" || identity.status === "profile_mismatch") {
    return failure("profile_not_found");
  }
  const profile = identity.profile;
  if (profile.role !== "student") return failure("forbidden");

  const { data: studentCourses, error: studentCoursesError } = await supabase
    .from("student_courses")
    .select("offering_id")
    .eq("student_id", profile.id)
    .not("offering_id", "is", null);

  if (studentCoursesError) return failure(classifyError(studentCoursesError));

  const assignedOfferingIds = (studentCourses ?? [])
    .map((row) => row.offering_id)
    .filter((offeringId): offeringId is string => typeof offeringId === "string");

  if (assignedOfferingIds.length === 0) return failure("offering_not_found");

  // The student RLS policy on course_offerings and the professor policy on
  // student_weekly_progress reference each other, so authenticated reads of
  // course_offerings fail with 42P17 (infinite recursion). Read with the
  // server-only admin client, scoped to the offering ids that were just
  // verified to belong to this student's own student_courses rows.
  const { data: offerings, error: offeringsError } = await createSupabaseAdminClient()
    .from("course_offerings")
    .select("id, course:courses(name), academic_term:academic_terms(semester_label)")
    .in("id", assignedOfferingIds);

  if (offeringsError) return failure(classifyError(offeringsError));

  const selection = selectCompanyLawOffering(
    assignedOfferingIds,
    (offerings ?? []) as CompanyLawOfferingRow[],
  );
  if (!selection.ok) return failure(selection.code);

  return selection;
}
