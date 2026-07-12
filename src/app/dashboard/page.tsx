import Link from "next/link";
import { ArrowRight, ClipboardList, GraduationCap, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { NotificationStrip } from "@/components/notifications/notification-strip";
import { Button } from "@/components/ui/button";
import { clearDemoSession } from "@/services/demo-auth.service";
import { getNotificationsForProfile } from "@/services/notifications.service";
import { getDemoProfile } from "@/services/session.service";
import { WeeklyMissions } from "@/components/roadmap/weekly-missions";
import { supabase } from "@/lib/supabase/client";
import { getMyCourses, type StudentCourseRecord } from "@/services/student-community.service";
import { StudentTodoCard, type StudentTodoItem } from "@/components/dashboard/student-todo-card";
import { StudentDashboardContent } from "@/components/dashboard/student-dashboard-content";
import { getAcademicEvents } from "@/services/academic-calendar.service";
import type { AcademicEvent } from "@/types/academic-calendar";
import { CourseTermEligibilityCard } from "@/components/dashboard/course-term-eligibility-card";
import { resolveCompanyLaw2026OfferingForSession } from "@/services/company-law-offering.server";
import { getCourseTermCompletionEligibility } from "@/services/course-term-completion-eligibility.server";

// Import Micro-Interactions
import { ScrollReveal, ScrollRevealList, ScrollRevealItem } from "@/components/ui/scroll-reveal";
import { HoverGlowCard } from "@/components/ui/hover-glow-card";
import { ShimmerButton } from "@/components/ui/shimmer-button";

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
    title: "학생 대시보드",
    description: "온보딩을 완료하고 전공 로드맵 추천으로 이어가세요.",
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
      <AppShell>
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
  const notifications = await getNotificationsForProfile(profile, 4);

  // Fetch student courses if student
  let coursesData: any[] = [];
  let myCourses: StudentCourseRecord[] = [];
  let todoItems: StudentTodoItem[] = [];
  let academicEvents: AcademicEvent[] = [];
  let eligibilityResult: Awaited<ReturnType<typeof getCourseTermCompletionEligibility>> | null = null;
  let eligibilityCourseName: string | null = null;
  if (profile.role === "student") {
    myCourses = await getMyCourses(profile.id);
    academicEvents = getAcademicEvents().filter(
      (event) => event.audience === "all" || event.audience === "student",
    );

    const [{ data: studentCourseData }, { data: noticeRows }, { data: counselingRows }] = await Promise.all([
      supabase
        .from("student_courses")
        .select(`
          course_id, current_week,
          courses ( name )
        `)
        .eq("student_id", profile.id),
      supabase
        .from("posts")
        .select("id, title, content, created_at, course_id, course:courses(id, name)")
        .eq("status", "active")
        .eq("board_key", "course_notice")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("counseling_requests")
        .select("id, topic, status, requested_start, suggested_start, professor_id, professor:professors(id, name)")
        .eq("student_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    if (studentCourseData && studentCourseData.length > 0) {
      for (const sc of studentCourseData) {
        const { data: progress } = await supabase
          .from("student_mission_progress")
          .select("calibrated_mission_json")
          .eq("student_id", profile.id)
          .eq("course_id", sc.course_id)
          .eq("week_number", sc.current_week)
          .maybeSingle();

        coursesData.push({
          courseId: sc.course_id,
          courseName: Array.isArray(sc.courses) ? sc.courses[0]?.name : (sc.courses as any)?.name,
          currentWeek: sc.current_week,
          initialGuide: progress?.calibrated_mission_json || null,
        });
      }
    }

    const noticeTodoItems = (noticeRows ?? [])
      .map((row: any) => {
        const text = `${row.title ?? ""} ${row.content ?? ""}`;
        const type = getTodoTypeFromText(text);
        if (!type) return null;

        const courseName = row.course?.name ?? null;
        const dateLabel = formatDateLabel(row.created_at);

        return {
          id: `notice-${row.id}`,
          title: row.title ?? "공지사항",
          description: row.content?.replace(/\s+/g, " ").slice(0, 80) ?? "공지사항이 등록되었습니다.",
          type: type === "exam" ? "exam" : "assignment",
          courseName,
          metaLabel: dateLabel ? "공지일" : null,
          metaValue: dateLabel,
          linkHref: row.course_id ? `/courses/${row.course_id}` : "/courses",
          linkLabel: "과목 공지 보기",
        } as StudentTodoItem;
      })
      .filter(Boolean) as StudentTodoItem[];

    const counselingTodoItems = (counselingRows ?? [])
      .filter((row: any) => ["pending", "scheduled", "approved"].includes(row.status))
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

    const offeringResolution = await resolveCompanyLaw2026OfferingForSession();
    eligibilityCourseName = offeringResolution.ok ? offeringResolution.courseName : null;
    eligibilityResult = offeringResolution.ok
      ? await getCourseTermCompletionEligibility(offeringResolution.offeringId)
      : offeringResolution;
  }

  return (
    <AppShell>
      <ScrollReveal>
        <section className="screen-hero">
          <span className="status-line">현재 사용자: {profile.name}</span>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
          <div className="actions">
            <Link href={copy.primaryHref} data-testid="dashboard-primary-action">
              <ShimmerButton>
                {copy.primaryLabel}
                <ArrowRight size={16} aria-hidden="true" />
              </ShimmerButton>
            </Link>
            <form action={clearDemoSession}>
              <Button type="submit" variant="outline" data-testid="dashboard-logout">
                로그아웃
              </Button>
            </form>
          </div>
        </section>
      </ScrollReveal>

      <ScrollReveal>
        <NotificationStrip notifications={notifications} />
      </ScrollReveal>

      {/* 학생 전용: 오늘 시간표 위젯 */}
      {profile.role === "student" && (
        <ScrollReveal>
          <StudentDashboardContent
            academicEvents={academicEvents}
            myCourses={myCourses}
            todoItems={todoItems}
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

      <ScrollRevealList>
        <section className="section dashboard-grid md:hidden">
          {profile.role === "student" && (
            <ScrollRevealItem>
              <Link href="/courses" className="block p-5 bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-xl text-white shadow-md hover:scale-[1.01] hover:bg-opacity-90 transition-all duration-200">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="text-lg font-bold mb-1">과목 및 강의 계획 관리</h3>
                      <p className="text-emerald-50 text-sm">수강 과목 로드맵 및 상세 정보</p>
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
