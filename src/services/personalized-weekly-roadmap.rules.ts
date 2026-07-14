import { normalizeWeeklyBaseline, type WeeklyBaseline } from "../types/personalized-weekly-roadmap";

export type RoadmapGenerationFingerprint = {
  sourceVersion: number;
  onboardingHash: string;
  inputHash: string;
};

export type PersonalizedWeeklyRoadmapFallback = WeeklyBaseline &
  RoadmapGenerationFingerprint & {
    personalizedGoal: string;
    learningActivities: string[];
    reviewGuide: string;
    generationStatus: "fallback";
    generatedByAi: false;
  };

export function shouldRegeneratePersonalizedRoadmap(
  saved: RoadmapGenerationFingerprint | null,
  sourceVersion: number,
  onboardingHash: string,
  inputHash: string,
) {
  return !saved
    || saved.sourceVersion !== sourceVersion
    || saved.onboardingHash !== onboardingHash
    || saved.inputHash !== inputHash;
}

export function buildFallbackRoadmaps(
  baseline: Array<Partial<WeeklyBaseline>>,
  sourceVersion: number,
  onboardingHash: string,
  inputHash: string,
): PersonalizedWeeklyRoadmapFallback[] {
  return normalizeWeeklyBaseline(baseline).map((week) => ({
    ...week,
    personalizedGoal: `${week.topic}의 핵심 개념을 이해합니다.`,
    learningActivities: [week.content],
    reviewGuide: "수업 노트와 핵심 용어를 다시 확인하고 이해가 어려운 부분을 기록하세요.",
    sourceVersion,
    onboardingHash,
    inputHash,
    generationStatus: "fallback",
    generatedByAi: false,
  }));
}
