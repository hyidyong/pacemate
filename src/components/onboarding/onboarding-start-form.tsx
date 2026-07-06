import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { beginOnboarding } from "@/services/onboarding.actions";
import type { DemoProfile } from "@/services/session.service";
import type { StudentType } from "@/services/onboarding.service";

type Role = DemoProfile["role"];

type StudentTypeOption = {
  value: StudentType;
  label: string;
  description: string;
};

type RoleOption = {
  value: Role;
  label: string;
  description: string;
};

type OnboardingStartFormProps = {
  error: string | null;
  step: "role" | "student-types";
  studentTypes: StudentTypeOption[];
};

const roleOptions: RoleOption[] = [
  {
    value: "student",
    label: "학생",
    description: "로드맵, 시간표, 커뮤니티, 상담 예약을 사용합니다.",
  },
  {
    value: "professor",
    label: "교수",
    description: "상담 승인, 질문 답변, 로드맵 수정 관리를 사용합니다.",
  },
  {
    value: "assistant",
    label: "조교",
    description: "운영 검토, FAQ, 과목 데이터를 보조 관리합니다.",
  },
];

export function OnboardingStartForm({ error, step, studentTypes }: OnboardingStartFormProps) {
  if (step === "student-types") {
    return (
      <form action={beginOnboarding} className="onboarding-form">
        {error ? <p className="form-error">{error}</p> : null}
        <input name="role" type="hidden" value="student" />
        <section className="onboarding-panel">
          <div className="community-section-heading">
            <h2>학생 유형</h2>
            <span>학생에게만 필요</span>
          </div>
          <div className="onboarding-step-note">
            <strong>로드맵 추천 기준을 먼저 맞출게요.</strong>
            <p>해당되는 유형을 하나 이상 고르면 로그인 후 학생 화면으로 이어집니다.</p>
          </div>
          <div className="onboarding-choice-grid">
            {studentTypes.map((item) => (
              <label className="onboarding-choice" key={item.value}>
                <input
                  defaultChecked={item.value === "freshman"}
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
        <div className="onboarding-submit-bar">
          <Button asChild variant="outline">
            <Link href="/onboarding">
              <ArrowLeft size={16} aria-hidden="true" />
              이전
            </Link>
          </Button>
          <Button type="submit">
            로그인 화면으로 이동
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="onboarding-form">
      {error ? <p className="form-error">{error}</p> : null}
      <section className="onboarding-panel">
        <div className="community-section-heading">
          <h2>사용자 타입</h2>
          <span>필수</span>
        </div>
        <div className="onboarding-step-note">
          <strong>처음 선택한 역할에 맞는 앱만 보여줘요.</strong>
          <p>학생은 한 단계 더 유형을 고르고, 교수·조교는 바로 로그인으로 이동합니다.</p>
        </div>
        <div className="onboarding-role-grid">
          {roleOptions.map((item) => (
            <Link
              className="onboarding-choice onboarding-choice-button"
              href={item.value === "student" ? "/onboarding?step=student-types" : `/login?role=${item.value}`}
              key={item.value}
            >
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
            </Link>
          ))}
        </div>
        <div className="onboarding-admin-link">
          <Link href="/login?role=admin">운영자 로그인</Link>
        </div>
      </section>
    </div>
  );
}
