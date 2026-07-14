import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getDemoProfile } from "@/services/session.service";
import type {
  StudentWeeklyProgressPreview,
  StudentWeeklyProgressRecord,
} from "@/types/student-weekly-progress";
import {
  mergeWeeklyProgressWithPlans,
  summarizeStudentCourseProgress,
} from "@/services/student-weekly-progress";

type ApprovedCompanyLawContext = {
  courseId: string;
  offeringId: string;
  termId: string;
  semesterLabel: string;
  plans: Array<{ weekNumber: number; title: string | null; topic: string | null }>;
};

function canReadServerOnlySupabase() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function getApprovedCompanyLawContext(
  offeringId?: string,
): Promise<ApprovedCompanyLawContext | null> {
  if (!canReadServerOnlySupabase()) {
    return null;
  }

  const supabase = createSupabaseAdminClient();
  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select("id")
    .eq("name", "회사법")
    .maybeSingle();

  if (courseError) throw new Error(`Failed to load company-law course: ${courseError.message}`);
  if (!course) return null;

  const { data: term, error: termError } = await supabase
    .from("academic_terms")
    .select("id, semester_label")
    .eq("semester_label", "2026-2")
    .maybeSingle();

  if (termError) throw new Error(`Failed to load 2026-2 term: ${termError.message}`);
  if (!term) return null;

  let offeringQuery = supabase
    .from("course_offerings")
    .select("id, course_id, term_id")
    .eq("course_id", course.id)
    .eq("term_id", term.id);

  if (offeringId) {
    offeringQuery = offeringQuery.eq("id", offeringId);
  }

  const { data: offering, error: offeringError } = await offeringQuery.maybeSingle();
  if (offeringError) throw new Error(`Failed to load company-law offering: ${offeringError.message}`);
  if (!offering) return null;

  const { data: plans, error: plansError } = await supabase
    .from("course_weekly_plans")
    .select("week_number, title, topic, review_required, professor_confirmed")
    .eq("offering_id", offering.id)
    .order("week_number", { ascending: true });

  if (plansError) throw new Error(`Failed to load approved weekly plans: ${plansError.message}`);
  if (
    !plans ||
    plans.length !== 15 ||
    plans.some((plan) => plan.review_required || !plan.professor_confirmed)
  ) {
    return null;
  }

  return {
    courseId: course.id,
    offeringId: offering.id,
    termId: term.id,
    semesterLabel: term.semester_label,
    plans: plans.map((plan) => ({
      weekNumber: plan.week_number,
      title: plan.title,
      topic: plan.topic,
    })),
  };
}

export async function getStudentWeeklyProgressForSession(): Promise<StudentWeeklyProgressPreview | null> {
  const profile = await getDemoProfile();
  if (profile?.role !== "student") return null;

  return getStudentWeeklyProgressForStudent(profile.id);
}

export async function getStudentWeeklyProgressForStudent(
  studentId: string,
): Promise<StudentWeeklyProgressPreview | null> {
  try {
    const context = await getApprovedCompanyLawContext();
    if (!context) return null;

    const supabase = createSupabaseAdminClient();
    const { data: savedRows, error: progressError } = await supabase
      .from("student_weekly_progress")
      .select(
        "week_number, progress_status_override, difficulty_level, understanding_level, private_note, shared_feedback, share_feedback_with_professor",
      )
      .eq("student_id", studentId)
      .eq("offering_id", context.offeringId)
      .order("week_number", { ascending: true });

    if (progressError) throw new Error(`Failed to load student weekly progress: ${progressError.message}`);

    const saved = (savedRows ?? []).map((row) => ({
      weekNumber: row.week_number,
      progressStatusOverride: row.progress_status_override,
      difficultyLevel: row.difficulty_level,
      understandingLevel: row.understanding_level,
      privateNote: row.private_note,
      sharedFeedback: row.shared_feedback,
      shareFeedbackWithProfessor: row.share_feedback_with_professor,
    })) as StudentWeeklyProgressRecord[];
    const weeks = mergeWeeklyProgressWithPlans(context.plans, saved);
    const summary = summarizeStudentCourseProgress(saved);

    return {
      courseName: "회사법",
      semesterLabel: context.semesterLabel,
      offeringId: context.offeringId,
      weeks,
      summary,
    };
  } catch {
    return null;
  }
}
