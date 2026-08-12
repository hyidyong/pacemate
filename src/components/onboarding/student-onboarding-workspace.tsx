"use client";

import { ArrowRight } from "lucide-react";
import { ElectronicEngineeringOnboardingWorkspace } from "@/components/onboarding/electronic-engineering-onboarding-workspace";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { completeStudentOnboarding } from "@/services/onboarding.actions";
import type { CurriculumPreview } from "@/types/curriculum";

type StudentOnboardingWorkspaceProps = {
  curriculumPreviews?: Partial<Record<"law" | "electronic-engineering", CurriculumPreview>>;
  error?: string | null;
};

export function StudentOnboardingWorkspace({
  curriculumPreviews = {},
  error = null,
}: StudentOnboardingWorkspaceProps) {
  return (
    <form action={completeStudentOnboarding} className="onboarding-form">
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <input name="returnTo" type="hidden" value="/roadmap" />
      <ElectronicEngineeringOnboardingWorkspace
        previews={curriculumPreviews}
      />
      <div className="onboarding-submit-bar">
        <PendingSubmitButton pendingLabel="저장 중…">
          로드맵 시작하기
          <ArrowRight size={16} aria-hidden="true" />
        </PendingSubmitButton>
      </div>
    </form>
  );
}
