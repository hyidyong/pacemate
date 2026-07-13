export type LearningProgressStatus = "not_started" | "in_progress" | "covered" | "needs_review" | "skipped" | null;
export type StudentLearningRecommendation = {
  type: "review_week" | "next_week";
  courseName: string;
  weekNumber: number;
  title: string;
  reason: string;
};

export function buildStudentLearningRecommendations(input: {
  courseName: string;
  plans: readonly { weekNumber: number; approved: boolean }[];
  progress: readonly { weekNumber: number; status: LearningProgressStatus }[];
}): StudentLearningRecommendation[] {
  const approvedWeeks = new Set(input.plans.filter((plan) => plan.approved).map((plan) => plan.weekNumber));
  if (!approvedWeeks.size) return [];
  const progressByWeek = new Map(input.progress.map((row) => [row.weekNumber, row.status]));
  const recommendations: StudentLearningRecommendation[] = [];
  const reviewWeek = [...approvedWeeks].sort((a, b) => a - b).find((week) => progressByWeek.get(week) === "needs_review");
  if (reviewWeek !== undefined) {
    recommendations.push({ type: "review_week", courseName: input.courseName, weekNumber: reviewWeek, title: `${reviewWeek}주차 다시 보기`, reason: `${input.courseName} ${reviewWeek}주차가 검토 필요 상태로 기록되어 있습니다.` });
  }
  const nextWeek = [...approvedWeeks].sort((a, b) => a - b).find((week) => {
    const status = progressByWeek.get(week);
    return status === undefined || status === null || status === "not_started" || status === "in_progress";
  });
  if (nextWeek !== undefined) {
    recommendations.push({ type: "next_week", courseName: input.courseName, weekNumber: nextWeek, title: `${nextWeek}주차 이어서 학습`, reason: `${input.courseName}의 승인된 주차계획 중 가장 앞선 미완료 주차입니다.` });
  }
  return recommendations.slice(0, 2);
}
