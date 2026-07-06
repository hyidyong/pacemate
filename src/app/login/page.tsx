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
import { DemoLoginButton } from "@/components/login/demo-login-button";

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  identifier: "식별자를 입력해 주세요.",
  password_required: "비밀번호를 입력해 주세요.",
  invalid_password: "이메일 또는 비밀번호가 올바르지 않습니다.",
  read: "권한을 확인하지 못했습니다.",
  create: "로그인 처리 중 문제가 발생했습니다.",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [params, profile] = await Promise.all([searchParams, getDemoProfile()]);
  if (profile) {
    redirect(getRoleHomePath(profile.role));
  }

  const error = params?.error ? errorMessages[params.error] : null;

  return (
    <AppShell>
      <section className="screen-hero">
        <span className="status-line">
          <LogIn size={15} aria-hidden="true" />
          로그인
        </span>
        <h1>로그인 후 전용 화면으로 이동해요.</h1>
        <p>
          이메일과 비밀번호로 로그인합니다. 학생은 로그인 후 최초 1회 맞춤형 로드맵 온보딩을 거칩니다.
        </p>
      </section>

      <section className="section login-layout">
        <Card>
          <CardHeader>
            <CardTitle>이메일 로그인</CardTitle>
            <CardDescription>
              학교 SSO 연동 전 데모 로그인입니다. 저장된 이메일 계정을 사용해 주세요.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createDemoSession} className="form-stack">
              {error ? <p className="form-error">{error}</p> : null}

              <label className="field">
                <span>이메일</span>
                <input
                  name="identifier"
                  required
                  placeholder="이메일 주소"
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

              <Button type="submit" data-testid="login-submit">
                로그인
                <ArrowRight size={16} aria-hidden="true" />
              </Button>
            </form>
            
            <DemoLoginButton />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>RBAC 적용 로그인 시스템</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="screen-list">
              {[
                "입력한 이메일과 비밀번호를 통해 사용자 인증(Auth Provider)을 수행합니다.",
                "로그인 성공 시, DB(profiles)에서 Role(학생, 교수, 관리자 등)을 조회합니다.",
                "조회된 권한에 따라 접근 가능한 대시보드 및 서비스로 자동 연결됩니다.",
              ].map((item) => (
                <li key={item}>
                  <p>{item}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
