import dynamicImport from "next/dynamic";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { getAcademicEvents } from "@/services/academic-calendar.service";
import { getUnreadNotificationCountByCategory } from "@/services/notifications.service";
import { getProfessorPageData } from "@/services/professor.service";
import { requireRoles } from "@/services/role-guard.service";
import { getDemoProfile } from "@/services/session.service";
import { clearDemoSession } from "@/services/demo-auth.service";
import { getProfessorCourseProgressReport } from "@/services/professor-course-progress-report.server";
import type { ProfessorCourseProgressReport } from "@/types/professor-course-progress-report";
import { getProfessorAnonymousWeeklyAggregate } from "@/services/professor-anonymous-weekly-aggregate.server";
import type { ProfessorAnonymousWeeklyAggregateReport } from "@/types/professor-anonymous-weekly-aggregate";
import { getProfessorQuestionInbox } from "@/services/professor-questions.server";
import { ProfessorProfileSummary } from "@/components/professor/professor-profile-summary";

// ✅ [Opt 4] ProfessorWorkspace(50KB)를 Lazy Load — 교수 페이지 초기 JS 대폭 감소
const ProfessorWorkspace = dynamicImport(
  () => import("@/components/professor/professor-workspace").then((m) => ({ default: m.ProfessorWorkspace })),
  {
    loading: () => (
      <section className="section">
        <div className="community-empty">
          <p>워크스페이스 불러오는 중...</p>
        </div>
      </section>
    ),
  }
);

export const dynamic = "force-dynamic";

const professorTabs = ["schedule", "roadmap", "questions", "counseling", "report"] as const;

function normalizeProfessorTab(tab?: string) {
  return professorTabs.find((item) => item === tab);
}

export default async function ProfessorPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string; sub?: string }>;
}) {
  const profile = await getDemoProfile();
  requireRoles(profile, ["professor", "assistant"]);
  const params = await searchParams;
  const initialTab = normalizeProfessorTab(params?.tab);

  const [
    data,
    unreadCounselingCount,
    questionCount,
    courseProgressReportResult,
    anonymousWeeklyAggregateResult,
    professorQuestionInbox,
  ] = await Promise.all([
    getProfessorPageData(profile),
    getUnreadNotificationCountByCategory(profile, "counseling"),
    getUnreadNotificationCountByCategory(profile, "question"),
    getProfessorCourseProgressReport(),
    getProfessorAnonymousWeeklyAggregate(),
    getProfessorQuestionInbox(),
  ]);

  const professorCourseProgressReport: ProfessorCourseProgressReport = courseProgressReportResult.ok
    ? courseProgressReportResult.report
    : { offerings: [] };
  const professorCourseProgressReportError = courseProgressReportResult.ok
    ? null
    : courseProgressReportResult.error;
  const professorAnonymousWeeklyAggregate: ProfessorAnonymousWeeklyAggregateReport =
    anonymousWeeklyAggregateResult.ok
      ? anonymousWeeklyAggregateResult.report
      : { aggregates: [] };
  const professorAnonymousWeeklyAggregateError = anonymousWeeklyAggregateResult.ok
    ? null
    : anonymousWeeklyAggregateResult.error;

  const pendingCounselingCount = data.counselingRequests.filter((request) => request.status === "pending").length;
  const effectiveCounselingCount = Math.max(pendingCounselingCount, unreadCounselingCount);
  const academicEvents = getAcademicEvents().filter(
    (event) => event.audience === "all" || event.audience === "professor",
  );

  return (
    <AppShell>
      <section className="screen-hero professor-hero">
        <h1>교수 대시보드</h1>
      </section>

      {data.professor ? <ProfessorProfileSummary professor={data.professor} courses={data.courses} /> : null}

      {profile?.role === "professor" ? (
        <section className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6">
          <Link
            href="/professor/weekly-plan-preview"
            className="inline-flex rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 transition-colors hover:bg-emerald-100"
          >
            주간 계획 초안 검토
          </Link>
        </section>
      ) : null}

      {data.professor ? (
        <ProfessorWorkspace
          adminTasks={data.adminTasks}
          academicEvents={academicEvents}
          availability={data.availability}
          counselingRequests={data.counselingRequests}
          courses={data.courses}
          faqs={data.faqs}
          initialTab={initialTab}
          initialSub={params?.sub}
          notificationCounts={{ counseling: effectiveCounselingCount, question: questionCount }}
          professor={data.professor}
          professorCourseProgressReport={professorCourseProgressReport}
          professorCourseProgressReportError={professorCourseProgressReportError}
          professorAnonymousWeeklyAggregate={professorAnonymousWeeklyAggregate}
          professorAnonymousWeeklyAggregateError={professorAnonymousWeeklyAggregateError}
          professorQuestionInbox={professorQuestionInbox}
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
