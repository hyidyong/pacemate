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
// KI-013: static import — the dynamic() wrapper deferred nothing (the chunk is
// preloaded with the page) and its Suspense seam left direct GETs stuck on the
// loading fallback. Heavy report internals lazy-load inside the workspace instead.
import { ProfessorWorkspace } from "@/components/professor/professor-workspace";

export const dynamic = "force-dynamic";

const professorTabs = ["schedule", "roadmap", "questions", "counseling", "report"] as const;

function normalizeProfessorTab(tab?: string) {
  return professorTabs.find((item) => item === tab);
}

export default async function ProfessorPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string; sub?: string; requestId?: string; questionId?: string }>;
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

  const academicEvents = getAcademicEvents().filter(
    (event) => event.audience === "all" || event.audience === "professor",
  );

  return (
    <AppShell>
      <section className="screen-hero professor-hero">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
          <h1>교수 대시보드</h1>
        </div>
      </section>

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pb-8 sm:px-6 lg:pb-10">
        {data.professor ? <ProfessorProfileSummary professor={data.professor} courses={data.courses} /> : null}

        {data.professor ? (
          <ProfessorWorkspace
            adminTasks={data.adminTasks}
            academicEvents={academicEvents}
            availability={data.availability}
            counselingRequests={data.counselingRequests}
            calendarRequests={data.calendarRequests}
            courses={data.courses}
            faqs={data.faqs}
            initialTab={initialTab}
            initialSub={params?.sub}
            initialHighlightedCounselingRequestId={params?.requestId}
            initialHighlightedQuestionId={params?.questionId}
            notificationCounts={{ counseling: unreadCounselingCount, question: questionCount }}
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
      </div>

      {profile ? (
        <form action={clearDemoSession} className="mypage-logout-form">
          <button type="submit">로그아웃</button>
        </form>
      ) : null}
    </AppShell>
  );
}
