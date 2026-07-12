"use client";

import { useMemo, useState } from "react";
import type { CurriculumPreview } from "@/types/curriculum";
import { buildElectronicEngineeringLongTermRoadmap } from "@/services/long-term-roadmap";
import type { LongTermRoadmapInput } from "@/types/long-term-roadmap";
import { ElectronicEngineeringCurriculumPreview } from "@/components/onboarding/electronic-engineering-curriculum-preview";
import { ElectronicEngineeringLongTermRoadmap } from "@/components/onboarding/electronic-engineering-long-term-roadmap";

type ElectronicEngineeringOnboardingWorkspaceProps = {
  preview: CurriculumPreview | null;
  currentGrade: number | null;
  currentSemester: 1 | 2 | null;
};

export function ElectronicEngineeringOnboardingWorkspace({
  preview,
  currentGrade,
  currentSemester,
}: ElectronicEngineeringOnboardingWorkspaceProps) {
  const [checkedCourseIds, setCheckedCourseIds] = useState<Set<string>>(() => new Set());

  const roadmapInput: LongTermRoadmapInput = useMemo(
    () => ({ currentGrade, currentSemester, completedCourseIds: [...checkedCourseIds] }),
    [checkedCourseIds, currentGrade, currentSemester],
  );
  const roadmap = useMemo(
    () => (preview ? buildElectronicEngineeringLongTermRoadmap(preview, roadmapInput) : null),
    [preview, roadmapInput],
  );

  function toggleCourse(courseId: string) {
    setCheckedCourseIds((current) => {
      const next = new Set(current);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });
  }

  return (
    <>
      <ElectronicEngineeringCurriculumPreview
        preview={preview}
        checkedCourseIds={checkedCourseIds}
        onToggleCourse={toggleCourse}
      />
      <ElectronicEngineeringLongTermRoadmap roadmap={roadmap} />
    </>
  );
}
