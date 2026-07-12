import type { SupportedCurriculumDepartment } from "@/types/curriculum";

export type LongTermRoadmapPhaseKey = "previous" | "current" | "future";
export type LongTermRoadmapCourseStatus = "completed" | "remaining";

export type LongTermRoadmapInput = {
  currentGrade: number | null;
  currentSemester: 1 | 2 | null;
  completedCourseIds: readonly string[];
};

export type LongTermRoadmapCourse = {
  id: string;
  sourceCourseName: string;
  recommendedGrade: number | null;
  status: LongTermRoadmapCourseStatus;
};

export type LongTermRoadmapPhase = {
  key: LongTermRoadmapPhaseKey;
  label: string;
  courses: LongTermRoadmapCourse[];
};

export type LongTermRoadmap = {
  kind: "draft_preview";
  department: Extract<SupportedCurriculumDepartment, "electronic-engineering">;
  versionKey: string;
  status: "draft";
  sourceVerified: boolean;
  admissionYearFrom: number | null;
  admissionYearTo: number | null;
  currentGrade: number | null;
  currentSemester: 1 | 2 | null;
  phases: Record<LongTermRoadmapPhaseKey, LongTermRoadmapPhase>;
  summary: {
    totalCourseCount: number;
    completedCourseCount: number;
    remainingCourseCount: number;
  };
  notices: readonly string[];
};
