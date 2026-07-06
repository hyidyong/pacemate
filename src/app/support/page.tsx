import Link from "next/link";
import { ArrowLeft, Clock3, Headphones } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { SupportForm } from "@/components/support/support-form";
import { requireRoles } from "@/services/role-guard.service";
import { getDemoProfile } from "@/services/session.service";

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const profile = await getDemoProfile();
  requireRoles(profile, ["student", "professor", "assistant", "admin"]);

  return (
    <AppShell>
      <section className="screen-hero support-hero">
        <Link href="/dashboard" className="status-line">
          <ArrowLeft size={15} aria-hidden="true" />
          운영 문의
        </Link>
        <h1>문의하기</h1>
        <p>
          단순 문의는 즉시 자동 답변하고, 추가 확인이 필요한 내용은 운영 문의로 접수합니다.
        </p>
        <div className="support-hours">
          <Clock3 aria-hidden="true" />
          <span>운영 상담 09:00~17:00</span>
        </div>
      </section>

      <section className="section support-layout">
        <aside className="support-guide">
          <Headphones aria-hidden="true" />
          <h2>빠른 확인</h2>
          <p>로그인, 상담 예약, 로드맵 오류처럼 자주 묻는 내용은 먼저 자동 답변으로 안내됩니다.</p>
        </aside>
        <SupportForm />
      </section>
    </AppShell>
  );
}
