import Link from "next/link";
import { ArrowRight, ClipboardList, GraduationCap, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { NotificationStrip } from "@/components/notifications/notification-strip";
import { Button } from "@/components/ui/button";
import { clearDemoSession } from "@/services/demo-auth.service";
import {
  getNotificationsForProfile,
  getUnreadNotificationCount,
} from "@/services/notifications.service";
import { getDemoProfile } from "@/services/session.service";
import { WeeklyMissions } from "@/components/roadmap/weekly-missions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getMyCourses, type StudentCourseRecord } from "@/services/student-community.service";
import { StudentTodoCard, type StudentTodoItem } from "@/components/dashboard/student-todo-card";
import { StudentDashboardContent } from "@/components/dashboard/student-dashboard-content";
import { getAcademicEvents } from "@/services/academic-calendar.service";
import type { AcademicEvent } from "@/types/academic-calendar";
import { CourseTermEligibilityCard } from "@/components/dashboard/course-term-eligibility-card";
import { resolveCompanyLaw2026OfferingForSession } from "@/services/company-law-offering.server";
import { getCourseTermCompletionEligibility } from "@/services/course-term-completion-eligibility.server";
import { getStudentLearningRecommendations } from "@/services/student-learning-recommendations.server";
import { StudentLearningRecommendationsCard } from "@/components/dashboard/student-learning-recommendations-card";
import { listStudentCourseNotices } from "@/services/course-notices.server";
import type { StudentAnnouncement } from "@/components/dashboard/student-announcement-feed";
import { StudentAnnouncementBanner } from "@/components/dashboard/student-announcement-banner";
import { StudentHeroCarousel } from "@/components/dashboard/student-hero-carousel";

// Import Micro-Interactions
import { ScrollReveal, ScrollRevealList, ScrollRevealItem } from "@/components/ui/scroll-reveal";
import { HoverGlowCard } from "@/components/ui/hover-glow-card";
import { ShimmerButton } from "@/components/ui/shimmer-button";

export const dynamic = "force-dynamic";

function getTodoTypeFromText(text: string): StudentTodoItem["type"] | null {
  const normalized = text.toLowerCase();
  if (/(과제|레포트|보고서|제출|마감)/.test(normalized)) {
    return "assignment";
  }
  if (/(시험|퀴즈)/.test(normalized)) {
    return "exam";
  }
  return null;
}

function formatDateLabel(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

const roleCopy = {
  student: {
    title: "",
    description: "",
    icon: ClipboardList,
    primaryHref: "/onboarding",
    primaryLabel: "온보딩 시작",
    items: ["학생 유형 선택", "이수 과목 입력", "로드맵 추천", "스크랩 확인"],
  },
  professor: {
    title: "교수 대시보드",
    description: "상담 신청과 에스컬레이션 질문을 처리하는 공간입니다.",
    icon: GraduationCap,
    primaryHref: "/professor",
    primaryLabel: "교수 화면으로",
    items: ["상담 가능 시간 관리", "승인/거절", "질문 답변", "FAQ 후보 저장"],
  },
  assistant: {
    title: "조교 대시보드",
    description: "공지, FAQ, 과목 정보와 질문 큐를 관리합니다.",
    icon: ShieldCheck,
    primaryHref: "/admin",
    primaryLabel: "운영 화면으로",
    items: ["공지 관리", "FAQ 관리", "과목 정보 관리", "에스컬레이션 큐"],
  },
  admin: {
    title: "관리자 대시보드",
    description: "서비스 운영 데이터와 신고, 사용자를 관리합니다.",
    icon: ShieldCheck,
    primaryHref: "/admin",
    primaryLabel: "관리자 화면으로",
    items: ["사용자 관리", "신고 처리", "과목 데이터", "운영 상태"],
  },
} as const;

export default async function DashboardPage() {
  const profile = await getDemoProfile();

  if (!profile) {
    return (
      <AppShell showSiteFooter>
        <ScrollReveal>
          <section className="screen-hero">
            <span className="status-line">로그인이 필요합니다</span>
            <h1>개인화 대시보드</h1>
            <p>
              데모 로그인을 완료하면 역할별 대시보드와 다음 작업을 확인할 수
              있습니다.
            </p>
            <div className="actions">
              <Link href="/login" data-testid="dashboard-login-link">
                <ShimmerButton>
                  데모 로그인
                  <ArrowRight size={16} aria-hidden="true" />
                </ShimmerButton>
              </Link>
            </div>
          </section>
        </ScrollReveal>
      </AppShell>
    );
  }

  const copy = roleCopy[profile.role];
  const shouldShowPrimaryAction = profile.role !== "student";
  const [notifications, unreadCount] = await Promise.all([
    getNotificationsForProfile(profile, 5),
    getUnreadNotificationCount(profile),
  ]);

  // Fetch student courses if student
  let coursesData: any[] = [];
  let myCourses: StudentCourseRecord[] = [];
  let todoItems: StudentTodoItem[] = [];
  let academicEvents: AcademicEvent[] = [];
  let announcements: StudentAnnouncement[] = [];
  let eligibilityResult: Awaited<ReturnType<typeof getCourseTermCompletionEligibility>> | null = null;
  let recommendationResult: Awaited<ReturnType<typeof getStudentLearningRecommendations>> | null = null;
  let eligibilityCourseName: string | null = null;
  if (profile.role === "student") {
    // This page runs on the server, so keep the signed-in user's cookies on
    // every query and let Supabase RLS enforce the same access as the API.
    const supabase = await createSupabaseServerClient();
    academicEvents = getAcademicEvents().filter(
      (event) => event.audience === "all" || event.audience === "student",
    );

    const offeringResolutionPromise = resolveCompanyLaw2026OfferingForSession();
    const [myCoursesResult, announcementsResult, studentCourseResult, counselingResult] = await Promise.all([
      getMyCourses(profile).catch((error) => {
        console.error("Dashboard my courses could not be loaded", error);
        return [] as StudentCourseRecord[];
      }),
      listStudentCourseNotices(profile.id).catch((error) => {
        console.error("Dashboard course notices could not be loaded", error);
        return [] as StudentAnnouncement[];
      }),
      supabase
        .from("student_courses")
        .select(`
          course_id, current_week,
          courses ( name )
        `)
        .eq("student_id", profile.id),
      supabase
        .from("counseling_requests")
        .select("id, topic, status, requested_start, suggested_start, professor_id, professor:professors(id, name)")
        .eq("student_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    myCourses = myCoursesResult;
    announcements = announcementsResult;
    const studentCourseData = studentCourseResult.data;
    const counselingRows = counselingResult.data;

    if (studentCourseData && studentCourseData.length > 0) {
      const courseIds = studentCourseData.map((course) => course.course_id);
      const currentWeeks = studentCourseData.map((course) => course.current_week);
      const { data: progressRows } = await supabase
        .from("student_mission_progress")
        .select("course_id, week_number, calibrated_mission_json")
        .eq("student_id", profile.id)
        .in("course_id", courseIds)
        .in("week_number", currentWeeks);
      const progressByCourseWeek = new Map(
        (progressRows ?? []).map((progress) => [
          `${progress.course_id}:${progress.week_number}`,
          progress.calibrated_mission_json,
        ]),
      );

      coursesData = studentCourseData.map((sc) => ({
          courseId: sc.course_id,
          courseName: Array.isArray(sc.courses) ? sc.courses[0]?.name : (sc.courses as any)?.name,
          currentWeek: sc.current_week,
          initialGuide: progressByCourseWeek.get(`${sc.course_id}:${sc.current_week}`) || null,
        }));
    }

    const noticeTodoItems = announcements
      .map((notice) => {
        const text = `${notice.title ?? ""} ${notice.content ?? ""}`;
        const type = getTodoTypeFromText(text);
        if (!type) return null;

        return {
          id: `notice-${notice.id}`,
          title: notice.title ?? "공지사항",
          description: notice.content?.replace(/\s+/g, " ").slice(0, 80) ?? "공지사항이 등록되었습니다.",
          type: type === "exam" ? "exam" : "assignment",
          courseName: notice.courseName ?? null,
          metaLabel: notice.createdAt ? "공지일" : null,
          metaValue: formatDateLabel(notice.createdAt),
          linkHref: notice.href,
          linkLabel: "과목 공지 보기",
        } as StudentTodoItem;
      })
      .filter(Boolean) as StudentTodoItem[];

    const counselingTodoItems = (counselingRows ?? [])
      .filter((row: any) => ["pending", "approved"].includes(row.status))
      .map((row: any) => ({
        id: `counseling-${row.id}`,
        title: row.topic ?? "상담 요청",
        description: row.status === "pending" ? "교수 승인 대기 중입니다." : "상담 일정이 확정되었습니다.",
        type: "counseling" as const,
        courseName: null,
        metaLabel: row.requested_start || row.suggested_start ? "상담일" : null,
        metaValue: formatDateLabel(row.requested_start || row.suggested_start),
        linkHref: "/counseling",
        linkLabel: "상담 확인",
      })) as StudentTodoItem[];

    todoItems = [...noticeTodoItems, ...counselingTodoItems].slice(0, 6);

    const offeringResolution = await offeringResolutionPromise;
    eligibilityCourseName = offeringResolution.ok ? offeringResolution.courseName : null;
    if (offeringResolution.ok) {
      [eligibilityResult, recommendationResult] = await Promise.all([
        getCourseTermCompletionEligibility(offeringResolution.offeringId),
        getStudentLearningRecommendations(offeringResolution.offeringId),
      ]);
    } else {
      eligibilityResult = offeringResolution;
      recommendationResult = { ok: false, code: "read_failed" };
    }
  }

  return (
    <AppShell
      showSiteFooter
      profile={profile}
      notifications={notifications}
      unreadCount={unreadCount}
    >
      {profile.role === "student" ? (
        <StudentHeroCarousel />
      ) : (
        <ScrollReveal>
          <section className="screen-hero">
            <h1>{copy.title}</h1>
            {copy.description ? <p>{copy.description}</p> : null}
            <div className="actions">
              {shouldShowPrimaryAction ? (
                <Link href={copy.primaryHref} data-testid="dashboard-primary-action">
                  <ShimmerButton>
                    {copy.primaryLabel}
                    <ArrowRight size={16} aria-hidden="true" />
                  </ShimmerButton>
                </Link>
              ) : null}
              <form action={clearDemoSession}>
              </form>
            </div>
          </section>
        </ScrollReveal>
      )}

      <ScrollReveal>
        <NotificationStrip notifications={notifications.slice(0, 4)} showSummary={profile.role !== "student"} />
      </ScrollReveal>

      {profile.role === "student" ? <StudentAnnouncementBanner announcement={announcements[0] ?? null} /> : null}

      {/* 학생 전용: 오늘 시간표 위젯 */}
      {profile.role === "student" && (
        <ScrollReveal>
          <StudentDashboardContent
            academicEvents={academicEvents}
            myCourses={myCourses}
            todoItems={todoItems}
            announcements={announcements}
          />
        </ScrollReveal>
      )}

      {profile.role === "student" && eligibilityResult && (
        <ScrollReveal>
          <section className="section" aria-label="과목 학기 완료 근거">
            <CourseTermEligibilityCard result={eligibilityResult} courseName={eligibilityCourseName} />
          </section>
        </ScrollReveal>
      )}

      {profile.role === "student" && recommendationResult && (
        <ScrollReveal><section className="section" aria-label="학생 맞춤 학습 추천"><StudentLearningRecommendationsCard result={recommendationResult} /></section></ScrollReveal>
      )}

      <ScrollRevealList>
        <section className="section dashboard-grid md:hidden">
          {profile.role === "student" && (
            <ScrollRevealItem>
              <Link href="/courses" className="block p-5 bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-xl text-white shadow-md hover:scale-[1.01] hover:bg-opacity-90 transition-all duration-200">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="text-lg font-bold mb-1">과목 및 강의 계획 관리</h3>
                    </div>
                    <ArrowRight size={24} className="shrink-0 opacity-80" />
                  </div>
              </Link>
            </ScrollRevealItem>
          )}
        </section>
      </ScrollRevealList>

      {profile.role === "student" && coursesData.length > 0 && (
        <ScrollRevealList>
          <section className="section">
            <ScrollRevealItem>
              <h2 style={{ fontSize: "1.25rem", fontWeight: "bold", marginBottom: "16px" }}>수강 중인 과목 학습 관리 (스마트 로드맵)</h2>
            </ScrollRevealItem>
            {coursesData.map((c) => (
              <ScrollRevealItem key={c.courseId}>
                <div style={{ marginBottom: "24px" }}>
                  <h3 style={{ fontSize: "1.1rem", fontWeight: "600", borderBottom: "2px solid var(--color-border)", paddingBottom: "8px" }}>{c.courseName}</h3>
                  <HoverGlowCard glowColor="rgba(59, 130, 246, 0.1)">
                    <div className="p-4 bg-white/50">
                      <WeeklyMissions 
                        studentId={profile.id}
                        courseId={c.courseId}
                        currentWeek={c.currentWeek}
                        initialGuide={c.initialGuide}
                      />
                    </div>
                  </HoverGlowCard>
                </div>
              </ScrollRevealItem>
            ))}
          </section>
        </ScrollRevealList>
      )}
    </AppShell>
  );
}
