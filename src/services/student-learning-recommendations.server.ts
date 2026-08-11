import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeUuid } from "@/lib/uuid";
import { buildStudentLearningRecommendations, type StudentLearningRecommendation } from "@/services/student-learning-recommendations";

export type StudentLearningRecommendationResult =
  | { ok: true; recommendations: StudentLearningRecommendation[] }
  | { ok: false; code: "invalid_request" | "unauthenticated" | "forbidden" | "read_failed" };

export async function getStudentLearningRecommendations(offeringIdValue: string): Promise<StudentLearningRecommendationResult> {
  const offeringId = normalizeUuid(offeringIdValue);
  if (!offeringId) return { ok: false, code: "invalid_request" };
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return { ok: false, code: "unauthenticated" };
  const { data: profile, error: profileError } = await supabase.from("profiles").select("id, auth_user_id, role").eq("auth_user_id", authData.user.id).maybeSingle();
  if (profileError || !profile) return { ok: false, code: "read_failed" };
  if (profile.auth_user_id !== authData.user.id || profile.role !== "student") return { ok: false, code: "forbidden" };
  // Ownership gate + admin reads: the student RLS policy on course_offerings
  // recurses (42P17) against the professor policy on student_weekly_progress,
  // so verify ownership via the student's own student_courses rows and read
  // the recursion-affected tables with the server-only admin client.
  const { data: ownedOffering, error: ownedOfferingError } = await supabase
    .from("student_courses")
    .select("offering_id")
    .eq("student_id", profile.id)
    .eq("offering_id", offeringId)
    .maybeSingle();
  if (ownedOfferingError) return { ok: false, code: "read_failed" };
  if (!ownedOffering) return { ok: false, code: "forbidden" };
  const admin = createSupabaseAdminClient();
  const { data: offering, error: offeringError } = await admin.from("course_offerings").select("id, course_id, term_id").eq("id", offeringId).maybeSingle();
  if (offeringError || !offering) return { ok: false, code: "read_failed" };
  const [plansResult, progressResult] = await Promise.all([
    admin.from("course_weekly_plans").select("week_number, review_required, professor_confirmed").eq("offering_id", offering.id).order("week_number"),
    admin.from("student_weekly_progress").select("week_number, progress_status_override").eq("student_id", profile.id).eq("offering_id", offering.id).order("week_number"),
  ]);
  if (plansResult.error || progressResult.error) return { ok: false, code: "read_failed" };
  return {
    ok: true,
    recommendations: buildStudentLearningRecommendations({
      courseName: "회사법",
      plans: (plansResult.data ?? []).map((row) => ({ weekNumber: row.week_number, approved: row.professor_confirmed && !row.review_required })),
      progress: (progressResult.data ?? []).map((row) => ({ weekNumber: row.week_number, status: row.progress_status_override })),
    }),
  };
}
