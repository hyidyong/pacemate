"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireDemoSession } from "@/lib/auth/demo-session";
import {
  getWeeklyPlanDraftByOfferingId,
  validateWeeklyPlanDraft,
} from "@/services/weekly-plan-draft.server";
import { deriveWeeklyPlanStatus } from "@/types/weekly-roadmap";

function readOfferingId(formData: FormData) {
  const offeringId = formData.get("offeringId");
  return typeof offeringId === "string" && offeringId.trim() ? offeringId : null;
}

function redirectWithApprovalState(state: "approved" | "already-approved" | "error"): never {
  redirect(`/professor/weekly-plan-preview?approval=${state}`);
}

function confidenceToNumber(confidence: "high" | "medium" | "low") {
  return confidence === "high" ? 0.9 : confidence === "medium" ? 0.6 : 0.3;
}

export async function approveWeeklyPlan(formData: FormData) {
  const offeringId = readOfferingId(formData);
  if (!offeringId) redirectWithApprovalState("error");

  let session;
  try {
    session = await requireDemoSession();
  } catch {
    redirect("/login");
  }

  if (session.role !== "professor") redirectWithApprovalState("error");

  const supabase = createSupabaseAdminClient();
  const { data: professor, error: professorError } = await supabase
    .from("professors")
    .select("id")
    .eq("profile_id", session.profileId)
    .maybeSingle();

  if (professorError || !professor) redirectWithApprovalState("error");

  const { data: offering, error: offeringError } = await supabase
    .from("course_offerings")
    .select("id, course_id, term_id, professor_id")
    .eq("id", offeringId)
    .eq("professor_id", professor.id)
    .maybeSingle();

  if (offeringError || !offering) redirectWithApprovalState("error");

  const draft = getWeeklyPlanDraftByOfferingId(offeringId);
  if (!draft || draft.status !== "draft" || draft.source.verifiedByProfessor) {
    redirectWithApprovalState("error");
  }

  const validation = validateWeeklyPlanDraft(draft);
  if (
    !validation.valid ||
    draft.professorId !== professor.id ||
    draft.courseId !== offering.course_id ||
    draft.termId !== offering.term_id
  ) {
    redirectWithApprovalState("error");
  }

  const { data: persistedPlans, error: persistedPlanError } = await supabase
    .from("course_weekly_plans")
    .select("offering_id, week_number, review_required, professor_confirmed")
    .eq("offering_id", offeringId);

  if (persistedPlanError) redirectWithApprovalState("error");

  if (deriveWeeklyPlanStatus(persistedPlans ?? []) === "approved") {
    redirectWithApprovalState("already-approved");
  }

  const rows = draft.weeks.map((week) => ({
    offering_id: draft.offeringId,
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

  const { error: upsertError } = await supabase
    .from("course_weekly_plans")
    .upsert(rows, { onConflict: "offering_id,week_number" });

  if (upsertError) redirectWithApprovalState("error");

  revalidatePath("/professor/weekly-plan-preview");
  redirectWithApprovalState("approved");
}
