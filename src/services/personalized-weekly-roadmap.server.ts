import "server-only";

import { createHash } from "node:crypto";
import { requireDemoSession } from "@/lib/auth/demo-session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  normalizeWeeklyBaseline,
  validateAiWeeklyRoadmaps,
  type AiWeeklyRoadmap,
  type WeeklyBaseline,
} from "@/types/personalized-weekly-roadmap";
import {
  buildFallbackRoadmaps,
  shouldRegeneratePersonalizedRoadmap,
} from "@/services/personalized-weekly-roadmap.rules";

type Source = { source_version: number; foundation_knowledge: string; focus_keywords: unknown; professor_notes: string };
type Persisted = { source_version: number; onboarding_hash: string; input_hash: string };
type DatabaseError = { code?: string } | null;
type TimetableEnrollment = {
  id: string;
  offering_id: string | null;
  course_id: string;
  semester_label: string | null;
  course: { name?: string | null } | Array<{ name?: string | null }> | null;
};

function courseName(course: TimetableEnrollment["course"]) {
  return Array.isArray(course) ? course[0]?.name ?? "과목" : course?.name ?? "과목";
}

async function resolveMissingTimetableOfferings(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  studentId: string,
  enrollments: TimetableEnrollment[],
) {
  const missingEnrollments = enrollments.filter((enrollment) => !enrollment.offering_id);
  if (!missingEnrollments.length) return enrollments;

  const courseIds = [...new Set(missingEnrollments.map((enrollment) => enrollment.course_id))];
  const [termsResult, offeringsResult, professorLinksResult] = await Promise.all([
    supabase
      .from("academic_terms")
      .select("id, semester_label, is_active")
      .order("is_active", { ascending: false })
      .order("starts_on", { ascending: false }),
    supabase
      .from("course_offerings")
      .select("id, course_id, term_id")
      .in("course_id", courseIds)
      .order("updated_at", { ascending: false }),
    supabase
      .from("course_professors")
      .select("course_id, professor_id, semester_label")
      .in("course_id", courseIds),
  ]);

  if (termsResult.error || offeringsResult.error || professorLinksResult.error) {
    throw new Error("Student timetable offerings could not be resolved");
  }

  const termIdByLabel = new Map(
    (termsResult.data ?? []).map((term) => [term.semester_label, term.id]),
  );
  const activeTermId = (termsResult.data ?? []).find((term) => term.is_active)?.id;
  const offeringByCourseAndTerm = new Map<string, string>();
  const fallbackOfferingByCourse = new Map<string, string>();
  const professorByCourseAndTermLabel = new Map<string, string>();
  const fallbackProfessorByCourse = new Map<string, string>();

  for (const offering of offeringsResult.data ?? []) {
    const key = `${offering.course_id}:${offering.term_id}`;
    if (!offeringByCourseAndTerm.has(key)) offeringByCourseAndTerm.set(key, offering.id);
    if (!fallbackOfferingByCourse.has(offering.course_id)) {
      fallbackOfferingByCourse.set(offering.course_id, offering.id);
    }
  }

  for (const link of professorLinksResult.data ?? []) {
    if (link.semester_label) {
      const key = `${link.course_id}:${link.semester_label}`;
      if (!professorByCourseAndTermLabel.has(key)) {
        professorByCourseAndTermLabel.set(key, link.professor_id);
      }
    }
    if (!fallbackProfessorByCourse.has(link.course_id)) {
      fallbackProfessorByCourse.set(link.course_id, link.professor_id);
    }
  }

  const offeringIdByEnrollmentId = new Map<string, string>();
  for (const enrollment of missingEnrollments) {
    const termId = enrollment.semester_label
      ? termIdByLabel.get(enrollment.semester_label) ?? activeTermId
      : activeTermId;
    let offeringId = termId
      ? offeringByCourseAndTerm.get(`${enrollment.course_id}:${termId}`)
      : fallbackOfferingByCourse.get(enrollment.course_id);

    if (!offeringId && termId) {
      const professorId = enrollment.semester_label
        ? professorByCourseAndTermLabel.get(`${enrollment.course_id}:${enrollment.semester_label}`)
          ?? fallbackProfessorByCourse.get(enrollment.course_id)
        : fallbackProfessorByCourse.get(enrollment.course_id);

      if (professorId) {
        const { data, error } = await supabase
          .from("course_offerings").insert({
            course_id: enrollment.course_id,
            professor_id: professorId,
            term_id: termId,
          })
          .select("id")
          .single();
        const createdOfferingId = data?.id;
        if (error || typeof createdOfferingId !== "string") {
          throw new Error("Student timetable offering could not be created");
        }
        offeringId = createdOfferingId;
        offeringByCourseAndTerm.set(`${enrollment.course_id}:${termId}`, createdOfferingId);
        fallbackOfferingByCourse.set(enrollment.course_id, createdOfferingId);
      }
    }

    if (offeringId) offeringIdByEnrollmentId.set(enrollment.id, offeringId);
  }

  await Promise.all(
    [...offeringIdByEnrollmentId.entries()].map(async ([enrollmentId, offeringId]) => {
      const { error } = await supabase
        .from("student_courses")
        .update({ offering_id: offeringId })
        .eq("id", enrollmentId)
        .eq("student_id", studentId)
        .is("offering_id", null);
      if (error) throw new Error("Student timetable offering could not be saved");
    }),
  );

  return enrollments.map((enrollment) => ({
    ...enrollment,
    offering_id: enrollment.offering_id ?? offeringIdByEnrollmentId.get(enrollment.id) ?? null,
  }));
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function toKeywords(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}

function isMissingPersonalizedRoadmapTable(error: DatabaseError) {
  return error?.code === "PGRST205";
}

function readLegacyRoadmapWeek(row: { week_number: number; guide_json: unknown }) {
  const guide = row.guide_json;
  if (!guide || typeof guide !== "object" || Array.isArray(guide)) return null;
  const value = guide as Record<string, unknown>;
  if (value.kind !== "personalized_weekly_roadmap") return null;

  return {
    week_number: row.week_number,
    baseline_title: typeof value.baselineTitle === "string" ? value.baselineTitle : "",
    baseline_topic: typeof value.baselineTopic === "string" ? value.baselineTopic : "",
    baseline_content: typeof value.baselineContent === "string" ? value.baselineContent : "",
    personalized_goal: typeof value.personalizedGoal === "string" ? value.personalizedGoal : "",
    learning_activities: Array.isArray(value.learningActivities) ? value.learningActivities : [],
    review_guide: typeof value.reviewGuide === "string" ? value.reviewGuide : "",
    generation_status: typeof value.generationStatus === "string" ? value.generationStatus : "fallback",
    generated_by_ai: value.generatedByAi === true,
    source_version: typeof value.sourceVersion === "number" ? value.sourceVersion : 1,
    onboarding_hash: typeof value.onboardingHash === "string" ? value.onboardingHash : "",
    input_hash: typeof value.inputHash === "string" ? value.inputHash : "",
  };
}

async function getLegacyRoadmapWeeks(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  studentId: string,
  offeringId: string,
) {
  const { data, error } = await supabase
    .from("student_weekly_progress")
    .select("week_number,guide_json")
    .eq("student_id", studentId)
    .eq("offering_id", offeringId)
    .order("week_number");
  if (error) throw new Error("Legacy personalized roadmap data could not be read");
  return (data ?? []).flatMap((row) => {
    const week = readLegacyRoadmapWeek(row);
    return week ? [week] : [];
  });
}

async function generateWithOpenAi(context: unknown): Promise<AiWeeklyRoadmap[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "당신은 대학 과목 개인화 로드맵 도우미입니다. 제공된 1~15주차 기준 계획 외의 출석, 평가, 일정, 필수 과제를 만들지 마세요. JSON 객체 {weeks:[{weekNumber,personalizedGoal,learningActivities,reviewGuide}]}만 반환하세요. 15개 주차를 순서대로 모두 반환하세요." },
          { role: "user", content: JSON.stringify(context) },
        ],
      }),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;
    const result = validateAiWeeklyRoadmaps((JSON.parse(content) as { weeks?: unknown }).weeks);
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

export async function getPersonalizedWeeklyRoadmapForSession(offeringId: string) {
  const session = await requireDemoSession();
  if (session.role !== "student") throw new Error("Student role is required");
  const supabase = createSupabaseAdminClient();
  const { data: enrollment, error: enrollmentError } = await supabase
    .from("student_courses")
    .select("id")
    .eq("student_id", session.profileId)
    .eq("offering_id", offeringId)
    .limit(1)
    .maybeSingle();
  if (enrollmentError || !enrollment) throw new Error("Offering is not assigned to the current student");

  const [plansResult, sourceResult, profileResult, savedResult] = await Promise.all([
    supabase.from("course_weekly_plans").select("week_number,title,topic,content").eq("offering_id", offeringId).eq("professor_confirmed", true).eq("review_required", false).order("week_number"),
    supabase.from("course_roadmap_personalization_sources").select("source_version,foundation_knowledge,focus_keywords,professor_notes").eq("offering_id", offeringId).maybeSingle(),
    supabase.from("student_profiles").select("target_career,interests,weak_basics,completed_courses_text,grade,semester").eq("profile_id", session.profileId).maybeSingle(),
    supabase.from("student_personalized_weekly_roadmaps").select("source_version,onboarding_hash,input_hash").eq("student_id", session.profileId).eq("offering_id", offeringId).order("week_number").limit(1),
  ]);
  if (
    plansResult.error
    || profileResult.error
    || (sourceResult.error && !isMissingPersonalizedRoadmapTable(sourceResult.error))
    || (savedResult.error && !isMissingPersonalizedRoadmapTable(savedResult.error))
  ) {
    throw new Error("Personalized roadmap data could not be read");
  }

  const baseline: WeeklyBaseline[] = normalizeWeeklyBaseline((plansResult.data ?? []).map((row: any) => ({ weekNumber: row.week_number, title: row.title, topic: row.topic, content: row.content })));
  const source = (sourceResult.data ?? { source_version: 1, foundation_knowledge: "", focus_keywords: [], professor_notes: "" }) as Source;
  const onboarding = profileResult.data ?? {};
  const onboardingHash = hash(onboarding);
  const inputHash = hash({ baseline, sourceVersion: source.source_version, foundationKnowledge: source.foundation_knowledge, keywords: toKeywords(source.focus_keywords), notes: source.professor_notes, onboarding });
  const legacyWeeks = isMissingPersonalizedRoadmapTable(savedResult.error)
    ? await getLegacyRoadmapWeeks(supabase, session.profileId, offeringId)
    : [];
  const savedRow = (savedResult.data?.[0] ?? legacyWeeks[0] ?? null) as Persisted | null;
  const saved = savedRow
    ? {
        sourceVersion: savedRow.source_version,
        onboardingHash: savedRow.onboarding_hash,
        inputHash: savedRow.input_hash,
      }
    : null;

  if (!shouldRegeneratePersonalizedRoadmap(saved, source.source_version, onboardingHash, inputHash)) {
    const { data, error } = await supabase.from("student_personalized_weekly_roadmaps").select("week_number,baseline_title,baseline_topic,baseline_content,personalized_goal,learning_activities,review_guide,generation_status,generated_by_ai").eq("student_id", session.profileId).eq("offering_id", offeringId).order("week_number");
    if (!error && data?.length === 15) return data;
  }

  const aiWeeks = await generateWithOpenAi({ baseline, professor: { foundationKnowledge: source.foundation_knowledge, focusKeywords: toKeywords(source.focus_keywords), notes: source.professor_notes }, student: onboarding });
  const fallback = buildFallbackRoadmaps(baseline, source.source_version, onboardingHash, inputHash);
  const rows = baseline.map((week, index) => {
    const ai = aiWeeks?.[index];
    return { student_id: session.profileId, offering_id: offeringId, week_number: week.weekNumber, baseline_title: week.title, baseline_topic: week.topic, baseline_content: week.content, personalized_goal: ai?.personalizedGoal ?? fallback[index].personalizedGoal, learning_activities: ai?.learningActivities ?? fallback[index].learningActivities, review_guide: ai?.reviewGuide ?? fallback[index].reviewGuide, source_version: source.source_version, onboarding_hash: onboardingHash, input_hash: inputHash, generation_status: ai ? "ready" : "fallback", generated_by_ai: Boolean(ai), generated_at: new Date().toISOString() };
  });
  const { error: writeError } = await supabase
    .from("student_personalized_weekly_roadmaps")
    .upsert(rows, { onConflict: "student_id,offering_id,week_number" });
  if (writeError && !isMissingPersonalizedRoadmapTable(writeError)) {
    throw new Error("Personalized roadmap data could not be saved");
  }
  if (isMissingPersonalizedRoadmapTable(writeError)) {
    const { error: legacyWriteError } = await supabase
      .from("student_weekly_progress").upsert(rows.map((row) => ({
        student_id: row.student_id,
        offering_id: row.offering_id,
        week_number: row.week_number,
        input_hash: row.input_hash,
        generated_at: row.generated_at,
        guide_json: {
          kind: "personalized_weekly_roadmap",
          sourceVersion: row.source_version,
          onboardingHash: row.onboarding_hash,
          inputHash: row.input_hash,
          baselineTitle: row.baseline_title,
          baselineTopic: row.baseline_topic,
          baselineContent: row.baseline_content,
          personalizedGoal: row.personalized_goal,
          learningActivities: row.learning_activities,
          reviewGuide: row.review_guide,
          generationStatus: row.generation_status,
          generatedByAi: row.generated_by_ai,
        },
      })), { onConflict: "student_id,offering_id,week_number" });
    if (legacyWriteError) throw new Error("Legacy personalized roadmap data could not be saved");
  }
  return rows;
}

export async function getStudentRoadmapOfferingsForSession() {
  const session = await requireDemoSession();
  if (session.role !== "student") return [];
  const supabase = createSupabaseAdminClient();
  const { data: enrollments, error } = await supabase
    .from("student_courses")
    .select("id, offering_id, course_id, semester_label, course:courses(name)")
    .eq("student_id", session.profileId);
  if (error) throw new Error("Student timetable courses could not be read");

  const reconciledEnrollments = await resolveMissingTimetableOfferings(
    supabase,
    session.profileId,
    (enrollments ?? []) as TimetableEnrollment[],
  );
  const offerings = new Map<string, { offeringId: string; courseId: string; courseName: string }>();

  for (const enrollment of reconciledEnrollments) {
    if (!enrollment.offering_id) continue;
    offerings.set(enrollment.offering_id, {
      offeringId: enrollment.offering_id,
      courseId: enrollment.course_id,
      courseName: courseName(enrollment.course),
    });
  }

  return [...offerings.values()];
}

export async function getSavedPersonalizedRoadmapForSession(offeringId: string) {
  const session = await requireDemoSession();
  if (session.role !== "student") return [];
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("student_personalized_weekly_roadmaps")
    .select("week_number,baseline_title,baseline_topic,baseline_content,personalized_goal,learning_activities,review_guide,generation_status,generated_by_ai")
    .eq("student_id", session.profileId).eq("offering_id", offeringId).order("week_number");
  if (isMissingPersonalizedRoadmapTable(error)) {
    return getLegacyRoadmapWeeks(supabase, session.profileId, offeringId);
  }
  if (error) return [];
  return data ?? [];
}

export async function getStudentRoadmapWorkspaceForSession(requestedOfferingId?: string) {
  const session = await requireDemoSession();
  if (session.role !== "student") {
    return { offerings: [], selectedOfferingId: "", weeks: [], completedWeeks: [] as number[] };
  }

  const offerings = await getStudentRoadmapOfferingsForSession();
  const selectedOfferingId = offerings.some((offering) => offering.offeringId === requestedOfferingId)
    ? requestedOfferingId!
    : offerings[0]?.offeringId ?? "";

  if (!selectedOfferingId) {
    return { offerings, selectedOfferingId, weeks: [], completedWeeks: [] as number[] };
  }

  const supabase = createSupabaseAdminClient();
  const [weeks, progressResult] = await Promise.all([
    getSavedPersonalizedRoadmapForSession(selectedOfferingId),
    supabase
      .from("student_weekly_progress")
      .select("week_number,progress_status_override")
      .eq("student_id", session.profileId)
      .eq("offering_id", selectedOfferingId)
      .eq("progress_status_override", "covered"),
  ]);

  if (progressResult.error) {
    throw new Error("Student roadmap progress could not be read");
  }

  return {
    offerings,
    selectedOfferingId,
    weeks,
    completedWeeks: (progressResult.data ?? []).map((row) => row.week_number),
  };
}
