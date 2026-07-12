import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveStudentOnboarding } from "@/services/onboarding.actions";
import { StudentType } from "@/services/onboarding.service";
import { ElectronicEngineeringCurriculumPreview } from "@/components/onboarding/electronic-engineering-curriculum-preview";
import type { CurriculumPreview } from "@/types/curriculum";

type StudentTypeOption = {
  value: StudentType;
  label: string;
  description: string;
};

export const studentTypes: StudentTypeOption[] = [
  {
    value: "freshman",
    label: "신입생",
    description: "학과 기초를 중심으로 첫 로드맵을 잡습니다.",
  },
  {
    value: "transfer",
    label: "편입생",
    description: "인정 학점을 고려해 빠른 핵심 과목 이수를 제안합니다.",
  },
  {
    value: "cross_major",
    label: "타전공생",
    description: "선수 지식이 부족할 수 있는 부분을 보완하는 방향으로 짭니다.",
  },
  {
    value: "double_major",
    label: "복수전공생",
    description: "필수 이수 학점 위주의 콤팩트한 로드맵을 만듭니다.",
  },
  {
    value: "current_student",
    label: "재학생",
    description: "진로 목표에 맞춰 심화 과목 위주로 추천합니다.",
  },
];

type StudentOnboardingFormProps = {
  error: string | null;
  savedProfile: any;
  electronicCurriculumPreview?: CurriculumPreview | null;
  returnTo?: string;
};

export function StudentOnboardingForm({
  error,
  savedProfile,
  electronicCurriculumPreview = null,
  returnTo,
}: StudentOnboardingFormProps) {
  const selectedTypes = new Set(savedProfile?.user_types ?? []);

  return (
    <form action={saveStudentOnboarding} className="onboarding-form">
      {error ? <p className="form-error">{error}</p> : null}
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}

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
              defaultValue={savedProfile?.interests?.join(", ") ?? ""}
              name="interests"
              placeholder="예: 민사소송, 회사법, 행정법"
            />
          </label>
          <label className="field">
            <span>약한 기초 지식</span>
            <input
              defaultValue={savedProfile?.weak_basics?.join(", ") ?? ""}
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

      <ElectronicEngineeringCurriculumPreview preview={electronicCurriculumPreview} />

      <div className="onboarding-submit-bar">
        <Button type="submit">
          {returnTo ? "변경사항 저장" : "저장하고 로드맵 보기"}
          <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </div>
    </form>
  );
}
