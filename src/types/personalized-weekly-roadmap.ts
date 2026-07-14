export type WeeklyBaseline = {
  weekNumber: number;
  title: string;
  topic: string;
  content: string;
};

export type AiWeeklyRoadmap = {
  weekNumber: number;
  personalizedGoal: string;
  learningActivities: string[];
  reviewGuide: string;
};

export type AiWeeklyRoadmapValidation =
  | { ok: true; value: AiWeeklyRoadmap[] }
  | { ok: false; reason: "fifteen_weeks_required" | "invalid_week_shape" };

function textOrFallback(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function normalizeWeeklyBaseline(rows: Array<Partial<WeeklyBaseline>>): WeeklyBaseline[] {
  const byWeek = new Map<number, Partial<WeeklyBaseline>>();

  for (const row of rows) {
    if (Number.isInteger(row.weekNumber) && row.weekNumber! >= 1 && row.weekNumber! <= 15) {
      byWeek.set(row.weekNumber!, row);
    }
  }

  return Array.from({ length: 15 }, (_, index) => {
    const weekNumber = index + 1;
    const row = byWeek.get(weekNumber);

    return {
      weekNumber,
      title: textOrFallback(row?.title, `${weekNumber}주차 학습`),
      topic: textOrFallback(row?.topic, "학습 계획 확인"),
      content: textOrFallback(row?.content, "교수 승인 계획을 확인하고 학습을 준비하세요."),
    };
  });
}

export function validateAiWeeklyRoadmaps(value: unknown): AiWeeklyRoadmapValidation {
  if (!Array.isArray(value) || value.length !== 15) {
    return { ok: false, reason: "fifteen_weeks_required" };
  }

  const weeks = value as AiWeeklyRoadmap[];
  const isValid = weeks.every((week, index) => (
    week?.weekNumber === index + 1
    && typeof week.personalizedGoal === "string"
    && Boolean(week.personalizedGoal.trim())
    && Array.isArray(week.learningActivities)
    && week.learningActivities.length > 0
    && week.learningActivities.every((activity) => typeof activity === "string" && Boolean(activity.trim()))
    && typeof week.reviewGuide === "string"
    && Boolean(week.reviewGuide.trim())
  ));

  return isValid
    ? { ok: true, value: weeks }
    : { ok: false, reason: "invalid_week_shape" };
}
