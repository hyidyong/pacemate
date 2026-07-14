"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireDemoSession } from "@/lib/auth/demo-session";
import {
  getWeeklyPlanDraftByOfferingId,
  getWeeklyPlanDraftByIdentity,
  validateWeeklyPlanDraft,
} from "@/services/weekly-plan-draft.server";
import { deriveWeeklyPlanStatus } from "@/types/weekly-roadmap";
import type { WeeklyPlanDraft } from "@/types/weekly-roadmap";

function readOfferingId(formData: FormData) {
  const offeringId = formData.get("offeringId");
  return typeof offeringId === "string" && offeringId.trim() ? offeringId : null;
}

function readCourseId(formData: FormData) {
  const courseId = formData.get("courseId");
  return typeof courseId === "string" && courseId.trim() ? courseId : null;
}

function readEditedWeeks(formData: FormData, draft: WeeklyPlanDraft) {
  const raw = formData.get("editedWeeks");
  if (typeof raw !== "string" || !raw.trim()) return draft.weeks;

  try {
    const edited = JSON.parse(raw) as unknown;
    if (!Array.isArray(edited) || edited.length !== draft.weeks.length) return null;

    const editedByWeek = new Map<number, { title: string; content: string }>();
    for (const item of edited) {
      if (!item || typeof item !== "object") return null;
      const weekNumber = "weekNumber" in item && typeof item.weekNumber === "number" ? item.weekNumber : null;
      const title = "title" in item && typeof item.title === "string" ? item.title.trim() : "";
      const content = "content" in item && typeof item.content === "string" ? item.content.trim() : "";
      if (weekNumber === null || !title || !content || title.length > 200 || content.length > 4000) return null;
      editedByWeek.set(weekNumber, { title, content });
    }

    if (editedByWeek.size !== draft.weeks.length || draft.weeks.some((week) => !editedByWeek.has(week.weekNumber))) return null;
    return draft.weeks.map((week) => {
      const editedWeek = editedByWeek.get(week.weekNumber);
      return editedWeek ? { ...week, title: editedWeek.title, topics: [editedWeek.content] } : week;
    });
  } catch {
    return null;
  }
}

function redirectWithApprovalState(
  state: "approved" | "already-approved" | "error",
  courseId?: string | null,
): never {
  const query = new URLSearchParams({ approval: state });
  if (courseId) query.set("courseId", courseId);
  redirect(`/professor/weekly-plan-preview?${query.toString()}`);
}

function confidenceToNumber(confidence: "high" | "medium" | "low") {
  return confidence === "high" ? 0.9 : confidence === "medium" ? 0.6 : 0.3;
}

export async function approveWeeklyPlan(formData: FormData) {
  const offeringId = readOfferingId(formData);
  const requestedCourseId = readCourseId(formData);
  if (!offeringId) redirectWithApprovalState("error", requestedCourseId);

  let session;
  try {
    session = await requireDemoSession();
  } catch {
    redirect("/login");
  }

  if (session.role !== "professor") redirectWithApprovalState("error", requestedCourseId);

  const supabase = createSupabaseAdminClient();
  const { data: professor, error: professorError } = await supabase
    .from("professors")
    .select("id")
    .eq("profile_id", session.profileId)
    .maybeSingle();

  if (professorError || !professor) redirectWithApprovalState("error", requestedCourseId);

  const { data: offering, error: offeringError } = await supabase
    .from("course_offerings")
    .select("id, course_id, term_id, professor_id")
    .eq("id", offeringId)
    .eq("professor_id", professor.id)
    .maybeSingle();

  if (offeringError || !offering) redirectWithApprovalState("error", requestedCourseId);

  const draft = getWeeklyPlanDraftByOfferingId(offeringId) ?? getWeeklyPlanDraftByIdentity({
    courseId: offering.course_id,
    professorId: professor.id,
    termId: offering.term_id,
  });
  if (!draft || draft.status !== "draft" || draft.source.verifiedByProfessor) {
    redirectWithApprovalState("error", offering.course_id);
  }

  const validation = validateWeeklyPlanDraft(draft);
  if (
    !validation.valid ||
    draft.professorId !== professor.id ||
    draft.courseId !== offering.course_id ||
    draft.termId !== offering.term_id
  ) {
    redirectWithApprovalState("error", offering.course_id);
  }

  const editedWeeks = readEditedWeeks(formData, draft);
  if (!editedWeeks) redirectWithApprovalState("error", offering.course_id);

  const { data: persistedPlans, error: persistedPlanError } = await supabase
    .from("course_weekly_plans")
    .select("offering_id, week_number, review_required, professor_confirmed")
    .eq("offering_id", offeringId);

  if (persistedPlanError) redirectWithApprovalState("error", offering.course_id);

  if (deriveWeeklyPlanStatus(persistedPlans ?? []) === "approved") {
    redirectWithApprovalState("already-approved", offering.course_id);
  }

  const rows = editedWeeks.map((week) => ({
    offering_id: offeringId,
    week_number: week.weekNumber,
    title: week.title,
    topic: week.topics.join(" · "),
    content: null,
    learning_objectives: [],
    preview_guide: null,
    review_guide: null,
    assignment_json: null,
    source_syllabus_id: draft.source.syllabusId,
    source_reference: week.sourceNote,
    extraction_confidence: confidenceToNumber(week.confidence),
    review_required: false,
    professor_confirmed: true,
  }));

  const { error: approvalError } = await supabase.rpc("approve_course_weekly_plan", {
    p_offering_id: offeringId,
    p_professor_id: professor.id,
    p_weeks: rows.map((row) => ({
      week_number: row.week_number,
      title: row.title,
      topic: row.topic,
      source_syllabus_id: row.source_syllabus_id,
      source_reference: row.source_reference,
      extraction_confidence: row.extraction_confidence,
    })),
  });

  if (approvalError) {
    console.error("approveWeeklyPlan transaction failed", approvalError.message);
    redirectWithApprovalState("error", offering.course_id);
  }

  revalidatePath("/professor/weekly-plan-preview");
  revalidatePath("/roadmap");
  revalidatePath("/notifications");
  redirectWithApprovalState("approved", offering.course_id);
}
