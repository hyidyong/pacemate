import Link from "next/link";
import { ArrowLeft, MessageSquareText } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { ProfessorNotificationSummary } from "@/components/professor/professor-notification-summary";
import { ProfessorWorkspace } from "@/components/professor/professor-workspace";
import { Button } from "@/components/ui/button";
import { getNotificationsForProfile } from "@/services/notifications.service";
import { getProfessorPageData } from "@/services/professor.service";
import { requireRoles } from "@/services/role-guard.service";
import { getDemoProfile } from "@/services/session.service";
import { clearDemoSession } from "@/services/demo-auth.service";
export const dynamic = "force-dynamic";

const professorTabs = ["overview", "roadmap", "questions", "counseling"] as const;

function normalizeProfessorTab(tab?: string) {
  return professorTabs.find((item) => item === tab);
}

export default async function ProfessorPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const profile = await getDemoProfile();
  requireRoles(profile, ["professor", "assistant"]);
  const params = await searchParams;
  const initialTab = normalizeProfessorTab(params?.tab);

  const [data, notifications] = await Promise.all([
    getProfessorPageData(profile),
    getNotificationsForProfile(profile, 4),
  ]);

  return (
    <AppShell>
      <section className="screen-hero professor-hero">
        <Link href="/dashboard" className="status-line">
          <ArrowLeft size={15} aria-hidden="true" />
          교수 모드
        </Link>
        <h1>교수 대시보드</h1>
        <p>
          담당 과목, 상담 가능 시간, 학생 질문 FAQ를 관리합니다. 학생 익명
          커뮤니티와는 분리하고, 공식 답변과 상담 흐름만 교수 모드에서 처리합니다.
        </p>
        <div className="actions">
          <Button asChild variant="outline">
            <Link href="/professor/lounge">
              교수 라운지
              <MessageSquareText size={16} aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </section>

      <ProfessorNotificationSummary notifications={notifications} />

      {data.professor ? (
        <ProfessorWorkspace
          adminTasks={data.adminTasks}
          availability={data.availability}
          counselingRequests={data.counselingRequests}
          courses={data.courses}
          faqs={data.faqs}
          initialTab={initialTab as any}
          professor={data.professor}
          roadmapRequests={data.roadmapRequests}
          teachingSlots={data.teachingSlots}
        />
      ) : (
        <section className="section">
          <div className="community-empty">
            <p>연결된 교수 정보를 찾지 못했습니다. 교수 역할로 로그인해 주세요.</p>
          </div>
        </section>
      )}

      {profile ? (
        <form action={clearDemoSession} className="mypage-logout-form">
          <button type="submit">로그아웃</button>
        </form>
      ) : null}
    </AppShell>
  );
}
