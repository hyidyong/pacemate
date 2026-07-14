export type StudentCourseStudyGuideTarget = "onboarding" | "weekly_log" | "professor" | "none";

export type StudentCourseStudyGuide = {
  course_summary: string;
  learning_method: {
    title: "효과적인 학습 방법";
    content: string;
  };
  prerequisites: {
    title: "필요한 선수 지식";
    content: string;
  };
  preview_review_guide: {
    title: "주차별 예습/복습 가이드";
    content: string;
  };
  personalized_content: {
    is_applied: boolean;
    target_area: StudentCourseStudyGuideTarget;
    additional_tips: string;
  };
};

export type StudentCourseStudyGuideView = StudentCourseStudyGuide & {
  courseName: string;
};

export type StudentCourseStudyGuideInput = {
  courseName: string;
  description?: string | null;
  prerequisites?: string | null;
  objectives?: string | null;
  usage?: string | null;
  weeks: Array<{
    weekNumber: number;
    title?: string | null;
    topic?: string | null;
    content?: string | null;
  }>;
  assessments: Array<{
    title: string;
    type?: string | null;
    weightPercent?: number | null;
    description?: string | null;
  }>;
  onboarding?: {
    targetCareer?: string | null;
    interests?: string[];
    weakBasics?: string[];
    completedCourses?: string | null;
  };
  weeklyLog?: Array<{
    weekNumber: number;
    difficultyLevel?: number | null;
    understandingLevel?: number | null;
    privateNote?: string | null;
  }>;
  professorNotes?: string | null;
};

export const STUDENT_COURSE_STUDY_GUIDE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "course_summary",
    "learning_method",
    "prerequisites",
    "preview_review_guide",
    "personalized_content",
  ],
  properties: {
    course_summary: { type: "string" },
    learning_method: {
      type: "object",
      additionalProperties: false,
      required: ["title", "content"],
      properties: {
        title: { type: "string", enum: ["효과적인 학습 방법"] },
        content: { type: "string" },
      },
    },
    prerequisites: {
      type: "object",
      additionalProperties: false,
      required: ["title", "content"],
      properties: {
        title: { type: "string", enum: ["필요한 선수 지식"] },
        content: { type: "string" },
      },
    },
    preview_review_guide: {
      type: "object",
      additionalProperties: false,
      required: ["title", "content"],
      properties: {
        title: { type: "string", enum: ["주차별 예습/복습 가이드"] },
        content: { type: "string" },
      },
    },
    personalized_content: {
      type: "object",
      additionalProperties: false,
      required: ["is_applied", "target_area", "additional_tips"],
      properties: {
        is_applied: { type: "boolean" },
        target_area: {
          type: "string",
          enum: ["onboarding", "weekly_log", "professor", "none"],
        },
        additional_tips: { type: "string" },
      },
    },
  },
} as const;

const FORBIDDEN_TEMPLATE_PHRASE = "학습 계획 확인";
const TARGETS = new Set<StudentCourseStudyGuideTarget>([
  "onboarding",
  "weekly_log",
  "professor",
  "none",
]);

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function hasExactKeys(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value as Record<string, unknown>).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function containsForbiddenTemplatePhrase(value: StudentCourseStudyGuide) {
  return [
    value.course_summary,
    value.learning_method.content,
    value.prerequisites.content,
    value.preview_review_guide.content,
    value.personalized_content.additional_tips,
  ].some((text) => text.includes(FORBIDDEN_TEMPLATE_PHRASE));
}

export function validateStudentCourseStudyGuide(value: unknown): value is StudentCourseStudyGuide {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const guide = value as StudentCourseStudyGuide;
  const valid = hasExactKeys(guide, [
    "course_summary",
    "learning_method",
    "prerequisites",
    "preview_review_guide",
    "personalized_content",
  ])
    && hasExactKeys(guide.learning_method, ["title", "content"])
    && hasExactKeys(guide.prerequisites, ["title", "content"])
    && hasExactKeys(guide.preview_review_guide, ["title", "content"])
    && hasExactKeys(guide.personalized_content, ["is_applied", "target_area", "additional_tips"])
    && isNonEmptyText(guide.course_summary)
    && guide.learning_method?.title === "효과적인 학습 방법"
    && isNonEmptyText(guide.learning_method?.content)
    && guide.prerequisites?.title === "필요한 선수 지식"
    && isNonEmptyText(guide.prerequisites?.content)
    && guide.preview_review_guide?.title === "주차별 예습/복습 가이드"
    && isNonEmptyText(guide.preview_review_guide?.content)
    && typeof guide.personalized_content?.is_applied === "boolean"
    && TARGETS.has(guide.personalized_content?.target_area)
    && typeof guide.personalized_content?.additional_tips === "string";

  if (!valid || containsForbiddenTemplatePhrase(guide)) return false;
  return guide.personalized_content.is_applied
    ? guide.personalized_content.target_area !== "none" && Boolean(guide.personalized_content.additional_tips.trim())
    : guide.personalized_content.target_area === "none" && guide.personalized_content.additional_tips === "";
}

function meaningfulOnboarding(input: StudentCourseStudyGuideInput) {
  const onboarding = input.onboarding;
  return Boolean(
    onboarding?.targetCareer?.trim()
    || onboarding?.completedCourses?.trim()
    || onboarding?.interests?.some((value) => value.trim())
    || onboarding?.weakBasics?.some((value) => value.trim()),
  );
}

function meaningfulWeeklyLog(input: StudentCourseStudyGuideInput) {
  return Boolean(input.weeklyLog?.some((row) => (
    row.difficultyLevel !== null && row.difficultyLevel !== undefined
    || row.understandingLevel !== null && row.understandingLevel !== undefined
    || row.privateNote?.trim()
  )));
}

export function getStudyGuidePersonalizationTarget(
  input: StudentCourseStudyGuideInput,
): StudentCourseStudyGuideTarget {
  if (meaningfulWeeklyLog(input)) return "weekly_log";
  if (input.professorNotes?.trim()) return "professor";
  if (meaningfulOnboarding(input)) return "onboarding";
  return "none";
}

function compactText(value: string | null | undefined, fallback: string) {
  return value?.replace(/\s+/g, " ").trim() || fallback;
}

function weeklyKeywords(input: StudentCourseStudyGuideInput) {
  return input.weeks
    .filter((week) => week.weekNumber >= 1 && week.weekNumber <= 15)
    .sort((a, b) => a.weekNumber - b.weekNumber)
    .slice(0, 6)
    .map((week) => `${week.weekNumber}주차 ${compactText(week.topic || week.title, "핵심 개념")}`);
}

function buildPersonalizedTips(input: StudentCourseStudyGuideInput) {
  const tips: string[] = [];
  const weakBasics = input.onboarding?.weakBasics?.map((value) => value.trim()).filter(Boolean) ?? [];
  if (weakBasics.length) tips.push(`* 선수 보완: ${weakBasics.join(", ")}부터 짧게 복습하세요.`);
  const interests = input.onboarding?.interests?.map((value) => value.trim()).filter(Boolean) ?? [];
  if (interests.length) tips.push(`* 관심 분야 연결: ${interests.join(", ")} 사례에 핵심 개념을 적용해 보세요.`);
  if (input.onboarding?.targetCareer?.trim()) {
    tips.push(`* 학습 목표: ${input.onboarding.targetCareer.trim()}에 필요한 설명·적용 능력을 기준으로 정리하세요.`);
  }

  const difficultWeeks = input.weeklyLog
    ?.filter((row) => (row.difficultyLevel ?? 0) >= 4 || (row.understandingLevel ?? 5) <= 2)
    .map((row) => `${row.weekNumber}주차`) ?? [];
  if (difficultWeeks.length) tips.push(`* 우선 복습: ${difficultWeeks.join(", ")}의 개념과 예제를 다시 풀어보세요.`);
  const privateNotes = input.weeklyLog
    ?.map((row) => row.privateNote?.trim())
    .filter((value): value is string => Boolean(value))
    .slice(0, 2) ?? [];
  if (privateNotes.length) tips.push(`* 학습 기록 반영: ${privateNotes.join(" / ")}`);
  if (input.professorNotes?.trim()) tips.push(`* 교수 강조: ${input.professorNotes.trim()}`);
  return tips.join("\n");
}

export function normalizeStudentCourseStudyGuide(
  guide: StudentCourseStudyGuide,
  input: StudentCourseStudyGuideInput,
): StudentCourseStudyGuide {
  const target = getStudyGuidePersonalizationTarget(input);
  const fallbackTips = buildPersonalizedTips(input);
  return {
    ...guide,
    personalized_content: target === "none"
      ? { is_applied: false, target_area: "none", additional_tips: "" }
      : {
          is_applied: true,
          target_area: target,
          additional_tips: guide.personalized_content.additional_tips.trim() || fallbackTips,
        },
  };
}

export function buildStudentCourseStudyGuideFallback(
  input: StudentCourseStudyGuideInput,
): StudentCourseStudyGuide {
  const topics = weeklyKeywords(input);
  const assessmentText = input.assessments
    .filter((item) => item.title.trim())
    .slice(0, 4)
    .map((item) => item.weightPercent === null || item.weightPercent === undefined
      ? item.title.trim()
      : `${item.title.trim()} ${item.weightPercent}%`)
    .join(", ");
  const target = getStudyGuidePersonalizationTarget(input);
  const prerequisite = input.prerequisites?.trim()
    ? input.prerequisites.trim()
    : "이 과목은 기초 입문 과목으로, 별도의 사전 지식 없이도 수강할 수 있습니다.";
  const flow = topics.length
    ? topics.join(" → ")
    : `${input.courseName}의 핵심 개념을 강의 순서대로 학습`;

  return {
    course_summary: compactText(
      input.description || input.objectives,
      `${input.courseName}의 핵심 개념을 주차별로 익히고 실제 문제에 적용하는 과정입니다.`,
    ),
    learning_method: {
      title: "효과적인 학습 방법",
      content: [
        `* 예습: 다음 주차의 핵심 키워드를 먼저 읽고 모르는 용어 3개를 표시하세요.`,
        `* 수업 직후: 핵심 개념을 한 문장으로 요약하고 예제 또는 판례·사례에 적용하세요.`,
        `* 복습: 주차별 난이도와 메모를 기록하고, 이해도가 낮은 주차를 48시간 안에 다시 보세요.`,
        assessmentText ? `* 평가 대비: ${assessmentText}의 비중에 맞춰 복습 시간을 배분하세요.` : "* 평가 대비: 강의계획서의 평가 항목별 요구 결과물을 체크리스트로 관리하세요.",
      ].join("\n"),
    },
    prerequisites: {
      title: "필요한 선수 지식",
      content: prerequisite,
    },
    preview_review_guide: {
      title: "주차별 예습/복습 가이드",
      content: `* 학습 흐름: ${flow}\n* 매주 예습에서는 용어와 질문을 정리하고, 복습에서는 핵심 개념·적용 예시·남은 질문을 각각 한 줄로 기록하세요.`,
    },
    personalized_content: target === "none"
      ? { is_applied: false, target_area: "none", additional_tips: "" }
      : { is_applied: true, target_area: target, additional_tips: buildPersonalizedTips(input) },
  };
}
