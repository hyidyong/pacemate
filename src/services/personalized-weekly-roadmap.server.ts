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

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function toKeywords(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
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
  const { data: enrollment, error: enrollmentError } = await supabase.from("student_courses").select("offering_id").eq("student_id", session.profileId).eq("offering_id", offeringId).maybeSingle();
  if (enrollmentError || !enrollment) throw new Error("Offering is not assigned to the current student");

  const [plansResult, sourceResult, profileResult, savedResult] = await Promise.all([
    supabase.from("course_weekly_plans").select("week_number,title,topic,content").eq("offering_id", offeringId).eq("professor_confirmed", true).eq("review_required", false).order("week_number"),
    supabase.from("course_roadmap_personalization_sources").select("source_version,foundation_knowledge,focus_keywords,professor_notes").eq("offering_id", offeringId).maybeSingle(),
    supabase.from("student_profiles").select("target_career,interests,weak_basics,completed_courses_text,grade,semester").eq("profile_id", session.profileId).maybeSingle(),
    supabase.from("student_personalized_weekly_roadmaps").select("source_version,onboarding_hash,input_hash").eq("student_id", session.profileId).eq("offering_id", offeringId).order("week_number").limit(1),
  ]);
  if (plansResult.error || sourceResult.error || profileResult.error || savedResult.error) throw new Error("Personalized roadmap data could not be read");

  const baseline: WeeklyBaseline[] = normalizeWeeklyBaseline((plansResult.data ?? []).map((row: any) => ({ weekNumber: row.week_number, title: row.title, topic: row.topic, content: row.content })));
  const source = (sourceResult.data ?? { source_version: 1, foundation_knowledge: "", focus_keywords: [], professor_notes: "" }) as Source;
  const onboarding = profileResult.data ?? {};
  const onboardingHash = hash(onboarding);
  const inputHash = hash({ baseline, sourceVersion: source.source_version, foundationKnowledge: source.foundation_knowledge, keywords: toKeywords(source.focus_keywords), notes: source.professor_notes, onboarding });
  const savedRow = (savedResult.data?.[0] ?? null) as Persisted | null;
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
  const { error: writeError } = await supabase.from("student_personalized_weekly_roadmaps").upsert(rows, { onConflict: "student_id,offering_id,week_number" });
  if (writeError) throw new Error("Personalized roadmap data could not be saved");
  return rows;
}

export async function getStudentRoadmapOfferingsForSession() {
  const session = await requireDemoSession();
  if (session.role !== "student") return [];
  const supabase = createSupabaseAdminClient();
  const { data: enrollments, error } = await supabase
    .from("student_courses")
    .select("offering_id, course_id, course:courses(name)")
    .eq("student_id", session.profileId)
    .not("offering_id", "is", null);
  if (error) throw new Error("Student timetable courses could not be read");
  return (enrollments ?? []).flatMap((row: any) => row.offering_id ? [{
    offeringId: row.offering_id as string,
    courseId: row.course_id as string,
    courseName: Array.isArray(row.course) ? row.course[0]?.name ?? "과목" : row.course?.name ?? "과목",
  }] : []);
}

export async function getSavedPersonalizedRoadmapForSession(offeringId: string) {
  const session = await requireDemoSession();
  if (session.role !== "student") return [];
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("student_personalized_weekly_roadmaps")
    .select("week_number,baseline_title,baseline_topic,baseline_content,personalized_goal,learning_activities,review_guide,generation_status,generated_by_ai")
    .eq("student_id", session.profileId).eq("offering_id", offeringId).order("week_number");
  if (error) return [];
  return data ?? [];
}
