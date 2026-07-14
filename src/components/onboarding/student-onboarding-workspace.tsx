"use client";

import { ArrowRight } from "lucide-react";
import { ElectronicEngineeringOnboardingWorkspace } from "@/components/onboarding/electronic-engineering-onboarding-workspace";
import { Button } from "@/components/ui/button";
import { completeStudentOnboarding } from "@/services/onboarding.actions";
import type { CurriculumPreview } from "@/types/curriculum";

type StudentOnboardingWorkspaceProps = {
  electronicCurriculumPreview?: CurriculumPreview | null;
  error?: string | null;
};

export function StudentOnboardingWorkspace({
  electronicCurriculumPreview = null,
  error = null,
}: StudentOnboardingWorkspaceProps) {
  return (
    <form action={completeStudentOnboarding} className="onboarding-form">
      {error ? <p className="form-error">{error}</p> : null}
      <input name="returnTo" type="hidden" value="/roadmap" />
      <ElectronicEngineeringOnboardingWorkspace
        preview={electronicCurriculumPreview}
        currentGrade={null}
        currentSemester={null}
      />
      <div className="onboarding-submit-bar">
        <Button type="submit">
          로드맵 시작하기
          <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </div>
    </form>
  );
}
