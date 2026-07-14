import type { PostgrestError } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getDemoProfile, type DemoProfile } from "@/services/session.service";
import {
  getWeeklyPlanDraftByOfferingId,
  listWeeklyPlanDrafts,
} from "@/services/weekly-plan-draft.server";
import { deriveWeeklyPlanStatus } from "@/types/weekly-roadmap";
import type {
  AcademicTerm,
  CourseOffering,
  CourseWeeklyPlan,
  StudentWeeklyProgress,
  WeeklyPlanDraft,
  WeeklyPlanReview,
} from "@/types/weekly-roadmap";

export type WeeklyRoadmapServiceErrorCode =
  | "unauthenticated"
  | "wrong_role"
  | "offering_not_assigned"
  | "database_configuration_missing"
  | "database_read_failed";

export class WeeklyRoadmapServiceError extends Error {
  constructor(
    public readonly code: WeeklyRoadmapServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WeeklyRoadmapServiceError";
  }
}

type SessionProfile = Pick<DemoProfile, "id" | "role">;

function requireStudent(profile: SessionProfile) {
  if (profile.role !== "student") {
    throw new WeeklyRoadmapServiceError(
      "wrong_role",
      "Weekly roadmap data is available to students only",
    );
  }
}

function isConfigurationError(error: PostgrestError) {
  return error.code === "42P01" || error.code === "42703" || error.code === "PGRST205";
}

function throwDatabaseError(error: PostgrestError): never {
  if (isConfigurationError(error)) {
    throw new WeeklyRoadmapServiceError(
      "database_configuration_missing",
      "Weekly roadmap database configuration is unavailable",
    );
  }

  throw new WeeklyRoadmapServiceError(
    "database_read_failed",
    "Weekly roadmap data could not be read",
  );
}

function getAdminClient() {
  try {
    return createSupabaseAdminClient();
  } catch {
    throw new WeeklyRoadmapServiceError(
      "database_configuration_missing",
      "Server-only Supabase configuration is unavailable",
    );
  }
}

async function getProfileOrThrow(): Promise<SessionProfile> {
  try {
    const profile = await getDemoProfile();
    if (profile) return profile;
    throw new WeeklyRoadmapServiceError("unauthenticated", "A valid session is required");
  } catch (error) {
    if (error instanceof WeeklyRoadmapServiceError) throw error;
    throw new WeeklyRoadmapServiceError("unauthenticated", "A valid session is required");
  }
}

export async function getActiveAcademicTermForSession(): Promise<AcademicTerm | null> {
  const profile = await getProfileOrThrow();
  requireStudent(profile);
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("academic_terms")
    .select("id, school_id, semester_label, starts_on, ends_on, timezone, total_weeks, is_active, created_at, updated_at")
    .eq("is_active", true)
    .order("starts_on", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throwDatabaseError(error);
  if (!data) return null;

  return {
    id: data.id,
    schoolId: data.school_id,
    semesterLabel: data.semester_label,
    startsOn: data.starts_on,
    endsOn: data.ends_on,
    timezone: data.timezone,
    totalWeeks: data.total_weeks,
    isActive: data.is_active,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function getStudentCourseOfferingsForSession(): Promise<CourseOffering[]> {
  const profile = await getProfileOrThrow();
  requireStudent(profile);
  const supabase = getAdminClient();
  const { data: enrollments, error: enrollmentError } = await supabase
    .from("student_courses")
    .select("offering_id")
    .eq("student_id", profile.id)
    .not("offering_id", "is", null);

  if (enrollmentError) throwDatabaseError(enrollmentError);

  const offeringIds = (enrollments ?? [])
    .map((enrollment) => enrollment.offering_id)
    .filter((offeringId): offeringId is string => typeof offeringId === "string");

  if (!offeringIds.length) return [];

  const { data, error } = await supabase
    .from("course_offerings")
    .select("id, course_id, professor_id, term_id, section_label, starts_on, ends_on, created_at, updated_at")
    .in("id", offeringIds)
    .order("created_at", { ascending: false });

  if (error) throwDatabaseError(error);

  return (data ?? []).map((offering) => ({
    id: offering.id,
    courseId: offering.course_id,
    professorId: offering.professor_id,
    termId: offering.term_id,
    sectionLabel: offering.section_label,
    startsOn: offering.starts_on,
    endsOn: offering.ends_on,
    createdAt: offering.created_at,
    updatedAt: offering.updated_at,
  }));
}

async function requireAssignedOffering(profile: SessionProfile, offeringId: string) {
  requireStudent(profile);
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("student_courses")
    .select("offering_id")
    .eq("student_id", profile.id)
    .eq("offering_id", offeringId)
    .maybeSingle();

  if (error) throwDatabaseError(error);
  if (!data) {
    throw new WeeklyRoadmapServiceError(
      "offering_not_assigned",
      "The requested offering is not assigned to this student",
    );
  }

  return supabase;
}

export async function getCourseWeeklyPlanForSession(
  offeringId: string,
  weekNumber: number,
): Promise<CourseWeeklyPlan | null> {
  const profile = await getProfileOrThrow();
  const supabase = await requireAssignedOffering(profile, offeringId);
  const { data, error } = await supabase
    .from("course_weekly_plans")
    .select("id, offering_id, week_number, title, topic, content, learning_objectives, preview_guide, review_guide, assignment_json, source_syllabus_id, source_reference, extraction_confidence, review_required, professor_confirmed, created_at, updated_at")
    .eq("offering_id", offeringId)
    .eq("week_number", weekNumber)
    .maybeSingle();

  if (error) throwDatabaseError(error);
  if (!data) return null;

  return {
    id: data.id,
    offeringId: data.offering_id,
    weekNumber: data.week_number,
    title: data.title,
    topic: data.topic,
    content: data.content,
    learningObjectives: Array.isArray(data.learning_objectives) ? data.learning_objectives : [],
    previewGuide: data.preview_guide,
    reviewGuide: data.review_guide,
    assignmentJson: data.assignment_json,
    sourceSyllabusId: data.source_syllabus_id,
    sourceReference: data.source_reference,
    extractionConfidence: data.extraction_confidence,
    reviewRequired: data.review_required,
    professorConfirmed: data.professor_confirmed,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function getStudentWeeklyProgressForSession(
  offeringId: string,
  weekNumber: number,
): Promise<StudentWeeklyProgress | null> {
  const profile = await getProfileOrThrow();
  const supabase = await requireAssignedOffering(profile, offeringId);
  const { data, error } = await supabase
    .from("student_weekly_progress")
    .select("id, student_id, offering_id, week_number, progress_status_override, difficulty_level, understanding_level, private_note, shared_feedback, share_feedback_with_professor, use_private_note_for_ai, guide_json, guide_version, input_hash, generated_at, created_at, updated_at")
    .eq("student_id", profile.id)
    .eq("offering_id", offeringId)
    .eq("week_number", weekNumber)
    .maybeSingle();

  if (error) throwDatabaseError(error);
  if (!data) return null;

  return {
    id: data.id,
    studentId: data.student_id,
    offeringId: data.offering_id,
    weekNumber: data.week_number,
    progressStatusOverride: data.progress_status_override,
    difficultyLevel: data.difficulty_level,
    understandingLevel: data.understanding_level,
    privateNote: data.private_note,
    sharedFeedback: data.shared_feedback,
    shareFeedbackWithProfessor: data.share_feedback_with_professor,
    usePrivateNoteForAi: data.use_private_note_for_ai,
    guideJson: data.guide_json,
    guideVersion: data.guide_version,
    inputHash: data.input_hash,
    generatedAt: data.generated_at,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/** Demo-only file-backed preview; never merges into approved student reads. */
export function getWeeklyRoadmapDraftPreviewForOffering(
  offeringId: string,
): WeeklyPlanDraft | null {
  return getWeeklyPlanDraftByOfferingId(offeringId);
}

/**
 * Returns only drafts whose offering is owned by the signed-in professor.
 * The profile-to-professor-to-offering relationship is resolved server-side;
 * no professor or offering identifier is accepted from the client.
 */
export async function getWeeklyPlanDraftsForProfessorSession(
  profile?: Pick<DemoProfile, "id" | "role">,
): Promise<WeeklyPlanReview[]> {
  const session = profile
    ? { profileId: profile.id, role: profile.role }
    : await getProfileOrThrow().then((currentProfile) => ({
        profileId: currentProfile.id,
        role: currentProfile.role,
      }));
  if (session.role !== "professor") {
    throw new WeeklyRoadmapServiceError(
      "wrong_role",
      "Weekly plan drafts are available to professors only",
    );
  }

  const supabase = getAdminClient();
  const { data: professors, error: professorError } = await supabase
    .from("professors")
    .select("id")
    .eq("profile_id", session.profileId)
    .limit(2);

  if (professorError) throwDatabaseError(professorError);
  if (!professors || professors.length !== 1) return [];

  const { data: offerings, error: offeringError } = await supabase
    .from("course_offerings")
    .select("id, course_id, professor_id, term_id")
    .eq("professor_id", professors[0].id);

  if (offeringError) throwDatabaseError(offeringError);

  const offeringIds = new Set((offerings ?? []).map((offering) => offering.id));
  const offeringByIdentity = new Map(
    (offerings ?? []).map((offering) => [
      `${offering.course_id}:${offering.professor_id}:${offering.term_id}`,
      offering,
    ]),
  );
  if (!offeringIds.size) return [];

  const { data: persistedPlans, error: persistedPlanError } = await supabase
    .from("course_weekly_plans")
    .select("offering_id, week_number, review_required, professor_confirmed")
    .in("offering_id", [...offeringIds]);

  if (persistedPlanError) throwDatabaseError(persistedPlanError);

  const persistedByOffering = new Map<string, typeof persistedPlans>();
  for (const plan of persistedPlans ?? []) {
    const rows = persistedByOffering.get(plan.offering_id) ?? [];
    rows.push(plan);
    persistedByOffering.set(plan.offering_id, rows);
  }

  return listWeeklyPlanDrafts()
    .flatMap((draft) => {
      const resolvedOffering =
        (offeringIds.has(draft.offeringId)
          ? (offerings ?? []).find((offering) => offering.id === draft.offeringId)
          : null) ??
        offeringByIdentity.get(`${draft.courseId}:${draft.professorId}:${draft.termId}`);

      if (!resolvedOffering) {
        return [];
      }

      return [{
        ...draft,
        offeringId: resolvedOffering.id,
      }];
    })
    .map((draft) => {
      const persisted = persistedByOffering.get(draft.offeringId) ?? [];
      return {
        ...draft,
        approvalStatus: deriveWeeklyPlanStatus(persisted),
        persistedWeekCount: persisted.length,
      };
    });
}
