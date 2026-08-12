import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { StudentRoadmapWorkspace } from "@/components/roadmap/student-roadmap-workspace";
import { Button } from "@/components/ui/button";
import { redirectNonStudent } from "@/services/role-guard.service";
import { getDemoProfile } from "@/services/session.service";
import { getStudentRoadmapWorkspaceForSession } from "@/services/personalized-weekly-roadmap.server";
import { DataErrorNotice } from "@/components/ui/data-error-notice";

export const dynamic = "force-dynamic";

export default async function RoadmapPage({
  searchParams,
}: {
  searchParams: Promise<{ offering?: string; refresh?: string }>;
}) {
  const profile = await getDemoProfile();
  redirectNonStudent(profile);

  const { offering, refresh } = await searchParams;
  // KI-003: a failed read must not render as "no courses registered".
  let loadFailed = false;
  const roadmapWorkspace = await getStudentRoadmapWorkspaceForSession(offering).catch((error) => {
    console.error("Roadmap page could not be loaded", error);
    loadFailed = true;
    return {
      offerings: [],
      selectedOfferingId: "",
      weeks: [],
      completedWeeks: [] as number[],
      hasPersonalizedRoadmap: false,
      courseGuide: null,
      weeklyFeedback: [],
    };
  });

  return (
    <AppShell>
      <section className="screen-hero">
        <Link href="/dashboard" className="status-line">
          <ArrowLeft size={15} aria-hidden="true" />
          나의 학습 로드맵
        </Link>
        <h1>이번 학기 학습 로드맵</h1>
        <p>
          시간표에 등록한 과목만 선택할 수 있습니다. 선택한 과목의 로드맵을 원할 때 생성하고,
          주차별 학습 기록을 저장해 보세요.
        </p>
        <div className="actions">
          <Button asChild>
            <Link href="/courses" data-testid="roadmap-courses-link">
              과목 정보 보기
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </section>

      {loadFailed ? <DataErrorNotice label="로드맵 데이터를 불러오지 못했습니다." /> : null}
      <StudentRoadmapWorkspace
        completedWeeks={roadmapWorkspace.completedWeeks}
        courseGuide={roadmapWorkspace.courseGuide}
        hasPersonalizedRoadmap={roadmapWorkspace.hasPersonalizedRoadmap}
        initialWeeks={roadmapWorkspace.weeks}
        initialWeeklyFeedback={roadmapWorkspace.weeklyFeedback}
        offerings={roadmapWorkspace.offerings}
        suggestProfessorPlanRefresh={refresh === "professor-plan"}
        selectedOfferingId={roadmapWorkspace.selectedOfferingId}
      />
    </AppShell>
  );
}
