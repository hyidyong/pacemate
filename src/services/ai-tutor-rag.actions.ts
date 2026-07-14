"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeQuestionCategory } from "@/lib/professor-question-normalization";
import { getDemoProfile } from "@/services/session.service";
import {
  sanitizeTutorCitations,
  selectTutorKnowledgeSources,
  type TutorKnowledgeSource,
  type TutorKnowledgeSourceType,
} from "@/services/ai-tutor-rag";

export type TutorCitation = {
  id: string;
  type: TutorKnowledgeSourceType;
  label: string;
  createdAt: string | null;
};

type TutorResult = {
  response: string;
  category: string;
  isEscalated: boolean;
  sources: TutorCitation[];
};

const sourceTypeLabels: Record<TutorKnowledgeSourceType, string> = {
  syllabus: "강의계획서",
  weekly_plan: "교수 승인 주차계획",
  announcement: "교수 공지사항",
  public_qa: "교수 공식 Q&A",
  bluebook: "Bluebook",
};

const MAX_SOURCE_CHARS = 2600;

function compactText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") return JSON.stringify(value);
  return "";
}

function toCitation(source: TutorKnowledgeSource): TutorCitation {
  return {
    id: source.id,
    type: source.type,
    label: source.title,
    createdAt: source.createdAt,
  };
}

function unavailableResult(message: string): TutorResult {
  return {
    response: message,
    category: "수업 운영",
    isEscalated: true,
    sources: [],
  };
}

export async function askAiTutor(message: string, courseId: string): Promise<TutorResult> {
  const profile = await getDemoProfile();
  const question = message.trim();
  const selectedCourseId = courseId.trim();
  if (!profile || profile.role !== "student" || !question || question.length > 2000 || !selectedCourseId) {
    return unavailableResult("질문과 과목을 확인할 수 없습니다.");
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return unavailableResult("학습 자료 연결을 준비하지 못했습니다. 교수님께 질문을 전달해 주세요.");
  }

  const { data: enrollment, error: enrollmentError } = await admin
    .from("student_courses")
    .select("course_id, offering_id")
    .eq("student_id", profile.id)
    .eq("course_id", selectedCourseId)
    .limit(1);
  if (enrollmentError || !enrollment?.length) {
    return unavailableResult("수강 중인 과목만 AI 튜터에게 질문할 수 있습니다.");
  }

  const offeringIds = Array.from(
    new Set(
      enrollment
        .map((row) => typeof row.offering_id === "string" ? row.offering_id : null)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const sources = await loadTutorKnowledgeSources(admin, profile.id, selectedCourseId, offeringIds);
  const rankedSources = selectTutorKnowledgeSources({
    courseId: selectedCourseId,
    question,
    sources,
  });
  if (!rankedSources.length) {
    return unavailableResult("등록된 강의 자료에서 질문의 근거를 찾지 못했습니다. 교수님께 질문을 전달해 주세요.");
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return unavailableResult("AI 응답 설정을 확인하지 못했습니다. 교수님께 질문을 전달해 주세요.");
  }

  const evidence = rankedSources
    .map((source) => `[${source.id}] ${sourceTypeLabels[source.type]} | ${source.title}\n${source.content.slice(0, MAX_SOURCE_CHARS)}`)
    .join("\n\n");

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(12_000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You are PaceMate's course-grounded AI tutor.",
              "Answer only from the evidence supplied by the application.",
              "Never invent dates, policies, schedules, grades, or course facts.",
              "If evidence is insufficient, set confidence below 0.7 and say that a professor or teaching assistant should confirm it.",
              "Return JSON only: {category:string, confidence:number, response:string, citationIds:string[]}.",
              "category must be one of: 과목 정보, 학사 행정, 수업 운영, 로드맵, 상담 필요.",
              "citationIds may contain only supplied bracket IDs and must support the answer.",
            ].join(" "),
          },
          {
            role: "user",
            content: `Student question:\n${question}\n\nCourse evidence:\n${evidence}`,
          },
        ],
      }),
    });
    if (!response.ok) return unavailableResult("AI 답변을 생성하지 못했습니다. 교수님께 질문을 전달해 주세요.");

    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return unavailableResult("AI 답변을 생성하지 못했습니다. 교수님께 질문을 전달해 주세요.");

    const parsed = JSON.parse(raw) as {
      category?: unknown;
      confidence?: unknown;
      response?: unknown;
      citationIds?: unknown;
    };
    const answer = typeof parsed.response === "string" ? parsed.response.trim() : "";
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
    const category = normalizeQuestionCategory(typeof parsed.category === "string" ? parsed.category : "") ?? "수업 운영";
    const citationIds = Array.isArray(parsed.citationIds)
      ? parsed.citationIds.filter((id): id is string => typeof id === "string")
      : [];
    const usedSources = sanitizeTutorCitations(citationIds, rankedSources)
      .flatMap((id) => rankedSources.filter((source) => source.id === id).map(toCitation));

    if (!answer) return unavailableResult("AI 답변을 해석하지 못했습니다. 교수님께 질문을 전달해 주세요.");

    return {
      response: answer,
      category,
      isEscalated: confidence < 0.7 || !usedSources.length,
      sources: usedSources,
    };
  } catch {
    return unavailableResult("AI 응답 처리 중 오류가 발생했습니다. 교수님께 질문을 전달해 주세요.");
  }
}

async function loadTutorKnowledgeSources(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  studentId: string,
  courseId: string,
  offeringIds: readonly string[],
): Promise<TutorKnowledgeSource[]> {
  const [{ data: syllabusRows }, { data: weeklyPlanRows }, { data: noticeRows }, { data: faqRows }, { data: profile }] = await Promise.all([
    admin.from("syllabi").select("id, source_name, parsed_text, parsed_data, updated_at").eq("course_id", courseId).order("created_at", { ascending: false }).limit(1),
    offeringIds.length
      ? admin
          .from("course_weekly_plans")
          .select("id, week_number, title, topic, content, learning_objectives, preview_guide, review_guide, assignment_json, updated_at")
          .in("offering_id", offeringIds)
          .eq("professor_confirmed", true)
          .eq("review_required", false)
          .order("week_number", { ascending: true })
          .limit(15)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    admin.from("posts").select("id, title, content, created_at").eq("course_id", courseId).eq("board_key", "course_notice").eq("status", "active").order("created_at", { ascending: false }).limit(20),
    admin.from("faqs").select("id, question, answer, updated_at").eq("course_id", courseId).not("approved_at", "is", null).order("updated_at", { ascending: false }).limit(20),
    admin.from("profiles").select("department_id").eq("id", studentId).maybeSingle(),
  ]);

  const sources: TutorKnowledgeSource[] = [
    ...(syllabusRows ?? []).flatMap((row: any) => {
      const content = compactText(row.parsed_text) || compactText(row.parsed_data);
      return content ? [{ id: `syllabus:${row.id}`, courseId, type: "syllabus" as const, title: row.source_name || "강의계획서", content, createdAt: row.updated_at ?? null }] : [];
    }),
    ...(weeklyPlanRows ?? []).flatMap((row: any) => {
      const content = [
        row.topic,
        row.content,
        compactText(row.learning_objectives),
        compactText(row.preview_guide),
        compactText(row.review_guide),
        compactText(row.assignment_json),
      ].filter((value) => typeof value === "string" && value.trim()).join("\n");
      return content ? [{
        id: `weekly_plan:${row.id}`,
        courseId,
        type: "weekly_plan" as const,
        title: `${row.week_number}주차 ${row.title || row.topic || "주차별 학습 계획"}`,
        content,
        createdAt: row.updated_at ?? null,
      }] : [];
    }),
    ...(noticeRows ?? []).flatMap((row: any) => row.title && row.content ? [{ id: `announcement:${row.id}`, courseId, type: "announcement" as const, title: row.title, content: row.content, createdAt: row.created_at ?? null }] : []),
    ...(faqRows ?? []).flatMap((row: any) => row.question && row.answer ? [{ id: `public_qa:${row.id}`, courseId, type: "public_qa" as const, title: row.question, content: row.answer, createdAt: row.updated_at ?? null }] : []),
  ];

  if (!profile?.department_id) return sources;

  const { data: versions } = await admin
    .from("curriculum_versions")
    .select("id, version_label, source_title, status")
    .eq("department_id", profile.department_id)
    .in("status", ["active", "draft"])
    .order("updated_at", { ascending: false })
    .limit(3);
  const versionIds = (versions ?? []).map((version: { id: string }) => version.id);
  if (!versionIds.length) return sources;

  const { data: bluebookRows } = await admin
    .from("curriculum_courses")
    .select("id, curriculum_version_id, source_course_name, requirement_type, recommended_grade, recommended_semester, metadata")
    .eq("course_id", courseId)
    .in("curriculum_version_id", versionIds)
    .limit(5);
  const versionById = new Map((versions ?? []).map((version: any) => [version.id, version]));
  sources.push(...(bluebookRows ?? []).map((row: any) => {
    const version = versionById.get(row.curriculum_version_id);
    return {
      id: `bluebook:${row.id}`,
      courseId,
      type: "bluebook" as const,
      title: version?.source_title || version?.version_label || "Bluebook",
      content: [row.source_course_name, row.requirement_type, row.recommended_grade ? `${row.recommended_grade}학년` : "", row.recommended_semester ? `${row.recommended_semester}학기` : "", compactText(row.metadata)].filter(Boolean).join(" | "),
      createdAt: null,
    };
  }));

  return sources;
}
