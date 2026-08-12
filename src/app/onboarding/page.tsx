import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { StudentOnboardingWorkspace } from "@/components/onboarding/student-onboarding-workspace";
import { getDraftCurriculumByDepartment } from "@/services/curriculum-query.server";
import type { CurriculumPreview } from "@/types/curriculum";
import { saveAssistantOnboarding } from "@/services/onboarding.actions";
import { getDemoProfile, getRoleHomePath } from "@/services/session.service";
import { electronicEngineeringDemoCurriculum } from "@/components/onboarding/electronic-engineering-demo-curriculum";

type OnboardingPageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

// The error redirect used to surface its raw code (the literal string
// "required") or raw DB text to the student (Stage 4, audit A-8). Map to
// Korean, mirroring the login page.
const errorMessages: Record<string, string> = {
  required: "필수 항목을 모두 선택해 주세요.",
  professor_required: "지도 교수님을 선택해 주세요.",
};

const fallbackErrorMessage = "요청을 처리하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const [profile, params] = await Promise.all([getDemoProfile(), searchParams]);
  if (!profile) {
    redirect("/login");
  }
  if (profile.role !== "student" && profile.role !== "assistant") {
    redirect(getRoleHomePath(profile.role));
  }

  const isAssistant = profile.role === "assistant";
  let curriculumPreviews: Partial<Record<"law" | "electronic-engineering", CurriculumPreview>> = {};
  if (!isAssistant) {
    const curriculumResults = await Promise.all(["law", "electronic-engineering"].map(async (department) => {
      try {
        const result = await getDraftCurriculumByDepartment(department);
        return result.kind === "preview" ? [department, result] as const : null;
      } catch {
        return null;
      }
    }));
    curriculumPreviews = Object.fromEntries(curriculumResults.filter((result): result is readonly ["law" | "electronic-engineering", CurriculumPreview] => result !== null));
    if (!curriculumPreviews["electronic-engineering"]) {
      curriculumPreviews["electronic-engineering"] = electronicEngineeringDemoCurriculum;
    }
  }
  const error = params?.error
    ? errorMessages[decodeURIComponent(params.error)] ?? fallbackErrorMessage
    : null;

  return (
    <AppShell>
      {isAssistant ? (
        <section className="screen-hero onboarding-hero">
          <Link href="/dashboard" className="status-line">
            <ArrowLeft size={15} aria-hidden="true" />
            온보딩
          </Link>
          <h1>조교 설정</h1>
          <p>지도 교수님 또는 소속 연구실을 선택해 주세요. 이후 담당 과목 및 알림이 연동됩니다.</p>
        </section>
      ) : null}

      <section className="section onboarding-layout">
        {isAssistant ? (
          <form action={saveAssistantOnboarding} className="onboarding-form">
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <section className="onboarding-panel">
              <div className="community-section-heading">
                <h2>지도 교수 및 연구실 선택</h2>
                <span>필수</span>
              </div>
              <div className="onboarding-field-grid">
                <label className="field">
                  <span>지도 교수</span>
                  <select name="professorId" required>
                    <option value="" disabled>교수님을 선택해주세요</option>
                    <option value="박성은">박성은 교수님 (민사소송법)</option>
                    <option value="기타">기타 연구실</option>
                  </select>
                </label>
              </div>
            </section>
            <div className="onboarding-submit-bar">
              <PendingSubmitButton pendingLabel="저장 중…">
                저장하고 대시보드 보기
                <ArrowRight size={16} aria-hidden="true" />
              </PendingSubmitButton>
            </div>
          </form>
        ) : (
          <StudentOnboardingWorkspace curriculumPreviews={curriculumPreviews} error={error} />
        )}
      </section>
    </AppShell>
  );
}
