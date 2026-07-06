import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { OnboardingStartForm } from "@/components/onboarding/onboarding-start-form";
import { Button } from "@/components/ui/button";
import { saveStudentOnboarding, saveAssistantOnboarding } from "@/services/onboarding.actions";
import { getStudentOnboardingProfile, type StudentType } from "@/services/onboarding.service";
import { redirectNonStudent } from "@/services/role-guard.service";
import { getDemoProfile, getRoleHomePath } from "@/services/session.service";

type OnboardingPageProps = {
  searchParams?: Promise<{
    error?: string;
    step?: string;
  }>;
};

const studentTypes: Array<{ value: StudentType; label: string; description: string }> = [
  {
    value: "freshman",
    label: "신입생",
    description: "전공 기초부터 순서대로 시작해요.",
  },
  {
    value: "transfer",
    label: "편입생",
    description: "인정 학점과 부족한 기초를 같이 봐요.",
  },
  {
    value: "cross_major",
    label: "타전공생",
    description: "낯선 용어와 선수 지식을 먼저 정리해요.",
  },
  {
    value: "double_major",
    label: "복수전공생",
    description: "본전공 시간표와 충돌하지 않게 설계해요.",
  },
  {
    value: "current_student",
    label: "재학생",
    description: "현재 이수 흐름을 기준으로 보완해요.",
  },
];

const requiredError = "학생 유형, 학년, 학기를 꼭 선택해 주세요.";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const [profile, params] = await Promise.all([getDemoProfile(), searchParams]);
  if (!profile) {
    redirect("/login");
  }
  if (profile.role !== "student" && profile.role !== "assistant") {
    redirect(getRoleHomePath(profile.role));
  }

  const savedProfile = profile.role === "student" ? await getStudentOnboardingProfile(profile) : null;
  const selectedTypes = new Set(savedProfile?.user_types ?? []);
  const error = params?.error
    ? params.error === "required"
      ? requiredError
      : decodeURIComponent(params.error)
    : null;
  
  const isAssistant = profile.role === "assistant";

  return (
    <AppShell>
      <section className="screen-hero onboarding-hero">
        <Link href="/dashboard" className="status-line">
          <ArrowLeft size={15} aria-hidden="true" />
          온보딩
        </Link>
        <h1>{isAssistant ? "조교 설정" : "내 상황에 맞는 로드맵을 만들어요."}</h1>
        <p>
          {isAssistant
            ? "지도 교수님 또는 소속 연구실을 선택해 주세요. 이후 담당 과목 및 알림이 연동됩니다."
            : "학생 유형, 현재 학기, 관심 분야, 약한 기초 과목을 저장하면 로드맵과 상담 흐름에서 같은 정보를 재사용할 수 있습니다."}
        </p>
      </section>

      <section className="section onboarding-layout">
        {isAssistant ? (
          <form action={saveAssistantOnboarding} className="onboarding-form">
            <section className="onboarding-panel">
              <div className="community-section-heading">
                <h2>지도 교수 및 연구실 선택</h2>
                <span>필수</span>
              </div>
              <div className="onboarding-field-grid">
                <label className="field">
                  <span>지도 교수</span>
                  <select name="professorId" required>
                    <option value="" disabled selected>교수님을 선택해주세요</option>
                    <option value="박성은">박성은 교수님 (민사소송법)</option>
                    <option value="기타">기타 연구실</option>
                  </select>
                </label>
              </div>
            </section>
            <div className="onboarding-submit-bar">
              <Button type="submit">
                저장하고 대시보드 보기
                <ArrowRight size={16} aria-hidden="true" />
              </Button>
            </div>
          </form>
        ) : (
          <form action={saveStudentOnboarding} className="onboarding-form">
            {error ? <p className="form-error">{error}</p> : null}

            <section className="onboarding-panel">
              <div className="community-section-heading">
                <h2>학생 유형</h2>
                <span>복수 선택</span>
              </div>
              <div className="onboarding-choice-grid">
                {studentTypes.map((item) => (
                  <label className="onboarding-choice" key={item.value}>
                    <input
                      defaultChecked={selectedTypes.has(item.value)}
                      name="userTypes"
                      type="checkbox"
                      value={item.value}
                    />
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                  </label>
                ))}
              </div>
            </section>

            <section className="onboarding-panel">
              <div className="community-section-heading">
                <h2>학기 정보</h2>
                <span>필수</span>
              </div>
              <div className="onboarding-field-grid">
                <label className="field">
                  <span>학년</span>
                  <select name="grade" defaultValue={savedProfile?.grade ?? ""} required>
                    <option value="" disabled>
                      선택
                    </option>
                    {[1, 2, 3, 4, 5, 6].map((grade) => (
                      <option key={grade} value={grade}>
                        {grade}학년
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>학기</span>
                  <select name="semester" defaultValue={savedProfile?.semester ?? ""} required>
                    <option value="" disabled>
                      선택
                    </option>
                    <option value="1">1학기</option>
                    <option value="2">2학기</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="onboarding-panel">
              <div className="community-section-heading">
                <h2>로드맵 입력값</h2>
                <span>선택</span>
              </div>
              <div className="form-stack">
                <label className="field">
                  <span>목표 진로</span>
                  <input
                    defaultValue={savedProfile?.target_career ?? ""}
                    name="targetCareer"
                    placeholder="예: 로스쿨, 공공기관, 기업 법무"
                  />
                </label>
                <label className="field">
                  <span>관심 분야</span>
                  <input
                    defaultValue={savedProfile?.interests.join(", ") ?? ""}
                    name="interests"
                    placeholder="예: 민사소송, 회사법, 행정법"
                  />
                </label>
                <label className="field">
                  <span>약한 기초 지식</span>
                  <input
                    defaultValue={savedProfile?.weak_basics.join(", ") ?? ""}
                    name="weakBasics"
                    placeholder="예: 민법 총칙, 조문 읽기, 판례 구조"
                  />
                </label>
                <label className="field">
                  <span>이미 들었거나 인정받은 과목</span>
                  <textarea
                    defaultValue={savedProfile?.completed_courses_text ?? ""}
                    name="completedCourses"
                    placeholder="예: 헌법총론, 민법총칙, 형법총론을 이수했습니다."
                    rows={5}
                  />
                </label>
              </div>
            </section>

            <div className="onboarding-submit-bar">
              <Button type="submit">
                저장하고 로드맵 보기
                <ArrowRight size={16} aria-hidden="true" />
              </Button>
            </div>
          </form>
        )}
      </section>
    </AppShell>
  );
}
