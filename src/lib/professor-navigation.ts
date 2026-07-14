export const professorCourseManagementItems = [
  {
    id: "roadmap-edit",
    label: "내 과목 로드맵 수정",
    href: "/professor?tab=roadmap&sub=roadmap-edit",
  },
  {
    id: "weekly-plan-preview",
    label: "주간 계획 초안 검토",
    href: "/professor/weekly-plan-preview",
  },
  {
    id: "sensitive-request",
    label: "민감한 수정 요청",
    href: "/professor?tab=roadmap&sub=sensitive-request",
  },
  {
    id: "course-faq",
    label: "과목 관련 질문 모음",
    href: "/professor?tab=roadmap&sub=course-faq",
  },
  {
    id: "course-settings",
    label: "기타 수업 설정",
    href: "/professor?tab=roadmap&sub=course-settings",
  },
] as const;

export const professorWeeklyPlanPreviewLink = professorCourseManagementItems.find(
  (item) => item.id === "weekly-plan-preview",
) ?? {
  label: "주간 계획 초안 검토",
  href: "/professor/weekly-plan-preview",
};
