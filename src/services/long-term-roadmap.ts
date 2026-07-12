import type { CurriculumPreview } from "@/types/curriculum";
import type {
  LongTermRoadmap,
  LongTermRoadmapCourse,
  LongTermRoadmapInput,
  LongTermRoadmapPhaseKey,
} from "@/types/long-term-roadmap";

const PHASE_LABELS: Record<LongTermRoadmapPhaseKey, string> = {
  previous: "이전 학년",
  current: "현재 학년",
  future: "향후 학년",
};

function getPhaseKey(
  recommendedGrade: number | null,
  currentGrade: number | null,
): LongTermRoadmapPhaseKey {
  if (recommendedGrade === null || currentGrade === null) {
    return "future";
  }

  if (recommendedGrade < currentGrade) {
    return "previous";
  }

  if (recommendedGrade === currentGrade) {
    return "current";
  }

  return "future";
}

export function buildElectronicEngineeringLongTermRoadmap(
  preview: Pick<
    CurriculumPreview,
    "department" | "version" | "courses"
  >,
  input: LongTermRoadmapInput,
): LongTermRoadmap {
  if (preview.department !== "electronic-engineering") {
    throw new Error("Electronic engineering roadmap requires the electronic-engineering curriculum");
  }

  const completedCourseIds = new Set(input.completedCourseIds);
  const phases = {
    previous: { key: "previous" as const, label: PHASE_LABELS.previous, courses: [] as LongTermRoadmapCourse[] },
    current: { key: "current" as const, label: PHASE_LABELS.current, courses: [] as LongTermRoadmapCourse[] },
    future: { key: "future" as const, label: PHASE_LABELS.future, courses: [] as LongTermRoadmapCourse[] },
  };

  for (const course of preview.courses) {
    const phase = getPhaseKey(course.recommendedGrade, input.currentGrade);
    phases[phase].courses.push({
      id: course.id,
      sourceCourseName: course.sourceCourseName,
      recommendedGrade: course.recommendedGrade,
      status: completedCourseIds.has(course.id) ? "completed" : "remaining",
    });
  }

  const completedCourseCount = preview.courses.reduce(
    (count, course) => count + (completedCourseIds.has(course.id) ? 1 : 0),
    0,
  );

  return {
    kind: "draft_preview",
    department: "electronic-engineering",
    versionKey: preview.version.versionKey,
    status: "draft",
    sourceVerified: preview.version.sourceVerified,
    admissionYearFrom: preview.version.admissionYearFrom,
    admissionYearTo: preview.version.admissionYearTo,
    currentGrade: input.currentGrade,
    currentSemester: input.currentSemester,
    phases,
    summary: {
      totalCourseCount: preview.courses.length,
      completedCourseCount,
      remainingCourseCount: preview.courses.length - completedCourseCount,
    },
    notices: [
      "이 로드맵은 전자공학과 draft curriculum을 바탕으로 한 추천 초안입니다.",
      "학점, 정확한 학기, 필수·선택, 선수과목과 공식 졸업 진행률은 판단하지 않습니다.",
      "입학연도 적용 범위와 원본 자료는 아직 공식 확인 전입니다.",
    ],
  };
}
