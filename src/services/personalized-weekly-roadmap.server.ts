import "server-only";

import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getDemoProfile, type DemoProfile } from "@/services/session.service";
import { getWeeklyPlanDraftByOfferingId } from "@/services/weekly-plan-draft.server";
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
import type {
  StudentDifficultyRating,
  StudentRoadmapCourseGuide,
  StudentWeeklyFeedbackDraft,
} from "@/types/student-weekly-progress";

type Source = { source_version: number; foundation_knowledge: string; focus_keywords: unknown; professor_notes: string };
type Persisted = { source_version: number; onboarding_hash: string; input_hash: string };
type DatabaseError = { code?: string; message?: string } | null;
type StudentProfile = DemoProfile & { role: "student" };
type TimetableEnrollment = {
  id: string;
  offering_id: string | null;
  course_id: string;
  semester_label: string | null;
  course: { name?: string | null } | Array<{ name?: string | null }> | null;
};
type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;
type BaselinePlanRow = { week_number: number; title: string | null; topic: string | null; content: string | null };
type StudyProgressInput = {
  week_number: number;
  progress_status_override: string | null;
  difficulty_level: number | null;
  understanding_level: number | null;
  private_note: string | null;
  use_private_note_for_ai: boolean;
};
type WeeklyFeedbackRow = {
  week_number: number;
  progress_status_override: string | null;
  difficulty_level: number | null;
  difficulty_rating?: StudentDifficultyRating | null;
  private_note: string | null;
  shared_feedback: string | null;
  professor_memo?: string | null;
  share_feedback_with_professor: boolean;
  updated_at: string | null;
};

async function getStudentProfile(): Promise<StudentProfile | null> {
  const profile = await getDemoProfile();
  return profile?.role === "student" ? (profile as StudentProfile) : null;
}

function createRoadmapSupabaseClient(): SupabaseAdminClient | null {
  try {
    return createSupabaseAdminClient();
  } catch (error) {
    console.error("Student roadmap Supabase admin client is unavailable", error);
    return null;
  }
}

function courseName(course: TimetableEnrollment["course"]) {
  return Array.isArray(course) ? course[0]?.name ?? "과목" : course?.name ?? "과목";
}

async function resolveMissingTimetableOfferings(
  supabase: SupabaseAdminClient,
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

function toBaselineRows(rows: readonly BaselinePlanRow[]): WeeklyBaseline[] {
  return normalizeWeeklyBaseline(rows.map((row) => ({
    weekNumber: row.week_number,
    title: row.title ?? undefined,
    topic: row.topic ?? undefined,
    content: row.content ?? undefined,
  })));
}

function getSyllabusBaseline(offeringId: string, rows: readonly BaselinePlanRow[]): WeeklyBaseline[] {
  if (rows.length) return toBaselineRows(rows);

  // File-backed drafts are the parsed syllabus source while a newly-added
  // offering has not yet persisted its normalized course_weekly_plans rows.
  // They are deliberately usable by students before professor review.
  const draft = getWeeklyPlanDraftByOfferingId(offeringId);
  if (!draft) return toBaselineRows([]);

  return normalizeWeeklyBaseline(draft.weeks.map((week) => ({
    weekNumber: week.weekNumber,
    title: week.title,
    topic: week.topics.join(" · "),
    content: week.sourceNote,
  })));
}

function toPersonalizationProgress(rows: readonly StudyProgressInput[]) {
  return rows.map((row) => ({
    weekNumber: row.week_number,
    status: row.progress_status_override,
    difficultyLevel: row.difficulty_level,
    understandingLevel: row.understanding_level,
    privateNote: row.use_private_note_for_ai ? row.private_note : null,
  }));
}

function isMissingPersonalizedRoadmapTable(error: DatabaseError) {
  return error?.code === "PGRST205";
}

function isMissingWeeklyFeedbackColumns(error: DatabaseError) {
  return error?.code === "PGRST204"
    || error?.code === "42703"
    || /difficulty_rating|professor_memo/i.test(error?.message ?? "");
}

async function getWeeklyFeedbackRows(
  supabase: SupabaseAdminClient,
  studentId: string,
  offeringId: string,
) {
  const modern = await supabase
    .from("student_weekly_progress")
    .select("week_number,progress_status_override,difficulty_level,difficulty_rating,private_note,shared_feedback,professor_memo,share_feedback_with_professor,updated_at")
    .eq("student_id", studentId)
    .eq("offering_id", offeringId)
    .order("week_number");
  if (!isMissingWeeklyFeedbackColumns(modern.error)) return modern;

  return supabase
    .from("student_weekly_progress")
    .select("week_number,progress_status_override,difficulty_level,private_note,shared_feedback,share_feedback_with_professor,updated_at")
    .eq("student_id", studentId)
    .eq("offering_id", offeringId)
    .order("week_number");
}

function toDifficultyRating(row: WeeklyFeedbackRow): StudentDifficultyRating | null {
  if (row.difficulty_rating === "HIGH" || row.difficulty_rating === "MID" || row.difficulty_rating === "LOW") {
    return row.difficulty_rating;
  }
  if (row.difficulty_level === null) return null;
  return row.difficulty_level >= 4 ? "HIGH" : row.difficulty_level === 3 ? "MID" : "LOW";
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
  supabase: SupabaseAdminClient,
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
  const profile = await getStudentProfile();
  if (!profile) throw new Error("Student role is required");
  const supabase = createRoadmapSupabaseClient();
  if (!supabase) throw new Error("Student roadmap database is unavailable");
  const { data: enrollment, error: enrollmentError } = await supabase
    .from("student_courses")
    .select("id")
    .eq("student_id", profile.id)
    .eq("offering_id", offeringId)
    .limit(1)
    .maybeSingle();
  if (enrollmentError || !enrollment) throw new Error("Offering is not assigned to the current student");

  const [plansResult, sourceResult, profileResult, progressResult, savedResult] = await Promise.all([
    // Baseline plans come from the parsed syllabus and stay usable before a
    // professor has reviewed them. Approval is an optional later input, not a
    // gate on a student's own roadmap.
    supabase.from("course_weekly_plans").select("week_number,title,topic,content").eq("offering_id", offeringId).order("week_number"),
    supabase.from("course_roadmap_personalization_sources").select("source_version,foundation_knowledge,focus_keywords,professor_notes").eq("offering_id", offeringId).maybeSingle(),
    supabase.from("student_profiles").select("target_career,interests,weak_basics,completed_courses_text,grade,semester").eq("profile_id", profile.id).maybeSingle(),
    supabase.from("student_weekly_progress").select("week_number,progress_status_override,difficulty_level,understanding_level,private_note,use_private_note_for_ai").eq("student_id", profile.id).eq("offering_id", offeringId).order("week_number"),
    supabase.from("student_personalized_weekly_roadmaps").select("source_version,onboarding_hash,input_hash").eq("student_id", profile.id).eq("offering_id", offeringId).order("week_number").limit(1),
  ]);
  if (
    plansResult.error
    || profileResult.error
    || progressResult.error
    || (sourceResult.error && !isMissingPersonalizedRoadmapTable(sourceResult.error))
    || (savedResult.error && !isMissingPersonalizedRoadmapTable(savedResult.error))
  ) {
    throw new Error("Personalized roadmap data could not be read");
  }

  const baseline = getSyllabusBaseline(
    offeringId,
    (plansResult.data ?? []) as BaselinePlanRow[],
  );
  const source = (sourceResult.data ?? { source_version: 1, foundation_knowledge: "", focus_keywords: [], professor_notes: "" }) as Source;
  const onboarding = profileResult.data ?? {};
  const studyProgress = toPersonalizationProgress((progressResult.data ?? []) as StudyProgressInput[]);
  const onboardingHash = hash(onboarding);
  const inputHash = hash({ baseline, sourceVersion: source.source_version, foundationKnowledge: source.foundation_knowledge, keywords: toKeywords(source.focus_keywords), notes: source.professor_notes, onboarding, studyProgress });
  const legacyWeeks = isMissingPersonalizedRoadmapTable(savedResult.error)
    ? await getLegacyRoadmapWeeks(supabase, profile.id, offeringId)
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
    const { data, error } = await supabase.from("student_personalized_weekly_roadmaps").select("week_number,baseline_title,baseline_topic,baseline_content,personalized_goal,learning_activities,review_guide,generation_status,generated_by_ai").eq("student_id", profile.id).eq("offering_id", offeringId).order("week_number");
    if (!error && data?.length === 15) return data;
  }

  const aiWeeks = await generateWithOpenAi({ baseline, professor: { foundationKnowledge: source.foundation_knowledge, focusKeywords: toKeywords(source.focus_keywords), notes: source.professor_notes }, student: { onboarding, studyProgress } });
  const fallback = buildFallbackRoadmaps(baseline, source.source_version, onboardingHash, inputHash);
  const rows = baseline.map((week, index) => {
    const ai = aiWeeks?.[index];
    return { student_id: profile.id, offering_id: offeringId, week_number: week.weekNumber, baseline_title: week.title, baseline_topic: week.topic, baseline_content: week.content, personalized_goal: ai?.personalizedGoal ?? fallback[index].personalizedGoal, learning_activities: ai?.learningActivities ?? fallback[index].learningActivities, review_guide: ai?.reviewGuide ?? fallback[index].reviewGuide, source_version: source.source_version, onboarding_hash: onboardingHash, input_hash: inputHash, generation_status: ai ? "ready" : "fallback", generated_by_ai: Boolean(ai), generated_at: new Date().toISOString() };
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
  const profile = await getStudentProfile();
  if (!profile) return [];
  const supabase = createRoadmapSupabaseClient();
  if (!supabase) return [];
  const { data: enrollments, error } = await supabase
    .from("student_courses")
    .select("id, offering_id, course_id, semester_label, course:courses(name)")
    .eq("student_id", profile.id);
  if (error) throw new Error("Student timetable courses could not be read");

  const reconciledEnrollments = await resolveMissingTimetableOfferings(
    supabase,
    profile.id,
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
  const profile = await getStudentProfile();
  if (!profile) return [];
  const supabase = createRoadmapSupabaseClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("student_personalized_weekly_roadmaps")
    .select("week_number,baseline_title,baseline_topic,baseline_content,personalized_goal,learning_activities,review_guide,generation_status,generated_by_ai")
    .eq("student_id", profile.id).eq("offering_id", offeringId).order("week_number");
  if (isMissingPersonalizedRoadmapTable(error)) {
    return getLegacyRoadmapWeeks(supabase, profile.id, offeringId);
  }
  if (error) return [];
  return data ?? [];
}

export async function getStudentRoadmapWorkspaceForSession(requestedOfferingId?: string) {
  const profile = await getStudentProfile();
  if (!profile) {
    return {
      offerings: [],
      selectedOfferingId: "",
      weeks: [],
      completedWeeks: [] as number[],
      hasPersonalizedRoadmap: false,
      courseGuide: null as StudentRoadmapCourseGuide | null,
      weeklyFeedback: [] as StudentWeeklyFeedbackDraft[],
    };
  }

  const offerings = await getStudentRoadmapOfferingsForSession().catch((error) => {
    console.error("Student roadmap offerings could not be loaded", error);
    return [];
  });
  const selectedOfferingId = offerings.some((offering) => offering.offeringId === requestedOfferingId)
    ? requestedOfferingId!
    : "";

  if (!selectedOfferingId) {
    return {
      offerings,
      selectedOfferingId,
      weeks: [],
      completedWeeks: [] as number[],
      hasPersonalizedRoadmap: false,
      courseGuide: null as StudentRoadmapCourseGuide | null,
      weeklyFeedback: [] as StudentWeeklyFeedbackDraft[],
    };
  }

  const supabase = createRoadmapSupabaseClient();
  if (!supabase) {
    return {
      offerings,
      selectedOfferingId,
      weeks: [],
      completedWeeks: [] as number[],
      hasPersonalizedRoadmap: false,
      courseGuide: null as StudentRoadmapCourseGuide | null,
      weeklyFeedback: [] as StudentWeeklyFeedbackDraft[],
    };
  }
  const [savedWeeks, progressResult, plansResult, courseResult, sourceResult] = await Promise.all([
    getSavedPersonalizedRoadmapForSession(selectedOfferingId).catch((error) => {
      console.error("Saved personalized roadmap could not be loaded", error);
      return [];
    }),
    getWeeklyFeedbackRows(supabase, profile.id, selectedOfferingId),
    supabase
      .from("course_weekly_plans")
      .select("week_number,title,topic,content")
      .eq("offering_id", selectedOfferingId)
      .order("week_number"),
    supabase
      .from("course_offerings")
      .select("course:courses(name,description,prerequisite_text)")
      .eq("id", selectedOfferingId)
      .maybeSingle(),
    supabase
      .from("course_roadmap_personalization_sources")
      .select("foundation_knowledge,focus_keywords,professor_notes")
      .eq("offering_id", selectedOfferingId)
      .maybeSingle(),
  ]);

  if (progressResult.error) {
    console.error("Student roadmap progress could not be read", progressResult.error);
  }

  if (plansResult.error) {
    console.error("Student roadmap syllabus could not be read", plansResult.error);
  }

  if (courseResult.error) {
    console.error("Student roadmap course guide could not be read", courseResult.error);
  }

  if (sourceResult.error && !isMissingPersonalizedRoadmapTable(sourceResult.error)) {
    console.error("Student roadmap study guide source could not be read", sourceResult.error);
  }

  const baselineWeeks = getSyllabusBaseline(
    selectedOfferingId,
    (plansResult.data ?? []) as BaselinePlanRow[],
  ).map((row) => ({
    week_number: row.weekNumber,
    baseline_title: row.title,
    baseline_topic: row.topic,
    baseline_content: row.content,
    personalized_goal: row.topic,
    learning_activities: [],
    review_guide: row.content,
  }));
  const selectedWeeks = savedWeeks.length ? savedWeeks : baselineWeeks;
  const rawCourse = courseResult.data?.course;
  const course = (Array.isArray(rawCourse) ? rawCourse[0] : rawCourse) as {
    name?: string | null;
    description?: string | null;
    prerequisite_text?: string | null;
  } | null | undefined;
  const source = sourceResult.data as {
    foundation_knowledge?: string | null;
    focus_keywords?: unknown;
    professor_notes?: string | null;
  } | null;
  const focusKeywords = Array.isArray(source?.focus_keywords)
    ? source.focus_keywords.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    : [];
  const weeklyFocus = selectedWeeks
    .slice(0, 3)
    .map((row) => row.baseline_topic)
    .filter(Boolean)
    .join(" · ");
  const courseGuide: StudentRoadmapCourseGuide = {
    courseName: course?.name?.trim() || offerings.find((item) => item.offeringId === selectedOfferingId)?.courseName || "선택 과목",
    description: course?.description?.trim() || "강의계획서의 주차별 핵심 주제를 따라 개념 이해와 복습을 반복합니다.",
    prerequisites: source?.foundation_knowledge?.trim() || course?.prerequisite_text?.trim() || "별도로 등록된 선수 지식이 없습니다.",
    studyGuide: source?.professor_notes?.trim()
      || (focusKeywords.length ? `핵심 키워드 ${focusKeywords.join(", ")}를 중심으로 예습과 복습을 진행하세요.` : "강의 전 핵심 주제를 미리 읽고, 수업 후 개인 메모와 질문을 남겨 복습하세요.")
      + (weeklyFocus ? ` 이번 학기 주요 흐름은 ${weeklyFocus}입니다.` : ""),
  };
  const weeklyFeedback: StudentWeeklyFeedbackDraft[] = progressResult.error
    ? []
    : ((progressResult.data ?? []) as WeeklyFeedbackRow[]).map((row) => ({
        weekNumber: row.week_number,
        difficultyRating: toDifficultyRating(row),
        personalMemo: row.private_note ?? "",
        professorMemo: row.professor_memo ?? (row.share_feedback_with_professor ? row.shared_feedback ?? "" : ""),
        updatedAt: row.updated_at,
      }));

  return {
    offerings,
    selectedOfferingId,
    weeks: selectedWeeks,
    hasPersonalizedRoadmap: savedWeeks.length > 0,
    courseGuide,
    weeklyFeedback,
    completedWeeks: progressResult.error
      ? []
      : ((progressResult.data ?? []) as WeeklyFeedbackRow[])
          .filter((row) => row.progress_status_override === "covered")
          .map((row) => row.week_number),
  };
}
