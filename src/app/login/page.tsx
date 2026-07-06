import Link from "next/link";
import { ArrowRight, LogIn } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createDemoSession } from "@/services/demo-auth.service";
import { getDemoProfile, getRoleHomePath } from "@/services/session.service";

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
    role?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  identifier: "식별자를 입력해 주세요.",
  password_required: "비밀번호를 입력해 주세요.",
  invalid_password: "비밀번호가 올바르지 않습니다.",
  read: "프로필을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  create: "프로필을 만들지 못했습니다. 다른 식별자로 다시 시도해 주세요.",
  admin_key: "관리자 로그인 키가 올바르지 않습니다.",
};

const roleLabels = {
  student: "학생",
  professor: "교수",
  assistant: "조교",
  admin: "관리자",
} as const;

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [params, profile] = await Promise.all([searchParams, getDemoProfile()]);
  if (profile) {
    redirect(getRoleHomePath(profile.role));
  }

  const error = params?.error ? errorMessages[params.error] : null;
  const defaultRole =
    params?.role === "professor" ||
    params?.role === "assistant" ||
    params?.role === "admin" ||
    params?.role === "student"
      ? params.role
      : "student";
  const isAdminLogin = defaultRole === "admin";

  return (
    <AppShell>
      <section className="screen-hero">
        <span className="status-line">
          <LogIn size={15} aria-hidden="true" />
          {isAdminLogin ? "운영자 로그인" : "온보딩 완료"}
        </span>
        <h1>{isAdminLogin ? "운영자 키로 로그인해요." : "로그인 후 전용 화면으로 이동해요."}</h1>
        <p>
          {isAdminLogin
            ? "관리자 화면은 별도 키가 있을 때만 접근할 수 있습니다."
            : "사용자 타입을 선택한 후, 학번 또는 이메일로 로그인합니다. 학생은 로그인 후 최초 1회 맞춤형 로드맵 온보딩을 거칩니다."}
        </p>
      </section>

      <section className="section login-layout">
        <Card>
          <CardHeader>
            <CardTitle>{isAdminLogin ? "관리자 전용 로그인" : "전용 로그인"}</CardTitle>
            <CardDescription>
              {isAdminLogin
                ? "테스트 단계에서는 관리자 키만 입력하면 운영 화면으로 이동합니다."
                : "학교 SSO 연동 전 데모 로그인입니다. 같은 식별자로 다시 로그인하면 저장된 역할 흐름이 이어집니다."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createDemoSession} className="form-stack">
              {error ? <p className="form-error">{error}</p> : null}

              {!isAdminLogin ? (
                <>
                  <label className="field">
                    <span>사용자 타입</span>
                    <select name="role" defaultValue={defaultRole} required data-testid="login-role">
                      <option value="student">학생</option>
                      <option value="professor">교수</option>
                      <option value="assistant">조교</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>식별자</span>
                    <input
                      name="identifier"
                      required
                      placeholder="학번 또는 이메일"
                      data-testid="login-identifier"
                    />
                  </label>
                  <label className="field">
                    <span>비밀번호</span>
                    <input
                      name="password"
                      type="password"
                      required
                      placeholder="비밀번호"
                      data-testid="login-password"
                    />
                  </label>
                  <label className="field">
                    <span>이름</span>
                    <input name="name" placeholder="표시 이름 (최초 1회 필수)" data-testid="login-name" />
                  </label>
                </>
              ) : (
                <input name="role" type="hidden" value="admin" data-testid="login-role" />
              )}

              {isAdminLogin ? (
                <label className="field">
                  <span>관리자 로그인 키</span>
                  <input
                    name="adminKey"
                    placeholder="관리자 키"
                    data-testid="login-admin-key"
                    required
                    type="password"
                  />
                  <small className="login-admin-hint">테스트 키: PACEMATE-ADMIN-2026</small>
                </label>
              ) : null}

              <Button type="submit" data-testid="login-submit">
                {isAdminLogin ? "관리자로 들어가기" : "로그인하고 시작하기"}
                <ArrowRight size={16} aria-hidden="true" />
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{isAdminLogin ? "운영자 접근 안내" : "이번 단계에서 실제로 하는 것"}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="screen-list">
              {isAdminLogin
                ? [
                    "관리자 로그인은 온보딩 선택지와 분리했습니다.",
                    "키가 맞을 때만 관리자 프로필 세션을 생성합니다.",
                    "운영 화면에서 로드맵 승인, 문의, 운영 알림을 확인합니다.",
                  ].map((item) => (
                    <li key={item}>
                      <p>{item}</p>
                    </li>
                  ))
                : [
                    "식별자와 역할을 Supabase profiles 테이블에 저장합니다.",
                    "학생 온보딩에서 고른 유형은 student_profiles에 이어 저장합니다.",
                    "로그인 성공 후 역할별 하단 바와 시작 화면이 자동으로 달라집니다.",
                  ].map((item) => (
                    <li key={item}>
                      <p>{item}</p>
                    </li>
                  ))}
            </ul>
            <div className="inline-actions">
              <Button asChild variant="outline">
                <Link href="/onboarding">온보딩 다시 선택</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
