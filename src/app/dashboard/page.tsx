import Link from "next/link";
import { ArrowRight, ClipboardList, GraduationCap, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { NotificationStrip } from "@/components/notifications/notification-strip";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { clearDemoSession } from "@/services/demo-auth.service";
import { getNotificationsForProfile } from "@/services/notifications.service";
import { getDemoProfile } from "@/services/session.service";
import { WeeklyMissions } from "@/components/roadmap/weekly-missions";
import { supabase } from "@/lib/supabase/client";

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
        <section className="screen-hero">
          <span className="status-line">로그인이 필요합니다</span>
          <h1>개인화 대시보드</h1>
          <p>
            데모 로그인을 완료하면 역할별 대시보드와 다음 작업을 확인할 수
            있습니다.
          </p>
          <div className="actions">
            <Button asChild>
              <Link href="/login" data-testid="dashboard-login-link">
                데모 로그인
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </section>
      </AppShell>
    );
  }

  const copy = roleCopy[profile.role];
  const Icon = copy.icon;
  const notifications = await getNotificationsForProfile(profile, 4);

  // Fetch student courses if student
  let coursesData: any[] = [];
  if (profile.role === "student") {
    const { data } = await supabase
      .from("student_courses")
      .select(`
        course_id, current_week,
        courses ( name )
      `)
      .eq("student_id", profile.id);
      
    if (data && data.length > 0) {
      // Fetch initial guide for each
      for (const sc of data) {
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
          initialGuide: progress?.calibrated_mission_json || null
        });
      }
    }
  }

  return (
    <AppShell>
      <section className="screen-hero">
        <span className="status-line">현재 사용자: {profile.name}</span>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
        <div className="actions">
          <Button asChild>
            <Link href={copy.primaryHref} data-testid="dashboard-primary-action">
              {copy.primaryLabel}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </Button>
          <form action={clearDemoSession}>
            <Button type="submit" variant="outline" data-testid="dashboard-logout">
              로그아웃
            </Button>
          </form>
        </div>
      </section>

      <NotificationStrip notifications={notifications} />

      <section className="section dashboard-grid">
        <Card>
          <CardHeader>
            <span className="icon-box">
              <Icon aria-hidden="true" />
            </span>
            <CardTitle>프로필</CardTitle>
            <CardDescription>
              Supabase `profiles`에 저장된 데모 사용자입니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="detail-grid">
              <div className="detail-item">
                <span>이름</span>
                <strong>{profile.name}</strong>
              </div>
              <div className="detail-item">
                <span>식별자</span>
                <strong>{profile.identifier}</strong>
              </div>
              <div className="detail-item">
                <span>역할</span>
                <strong>{profile.role}</strong>
              </div>
            </div>
          </CardContent>
        </Card>

        {profile.role === "student" && (
          <div className="md:hidden">
            <Link href="/courses" className="block p-5 bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-xl text-white shadow-md hover:scale-[1.01] hover:bg-opacity-90 transition-all duration-200">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold mb-1">과목 및 강의 계획 관리</h3>
                  <p className="text-emerald-50 text-sm">수강 과목 로드맵 및 상세 정보</p>
                </div>
                <ArrowRight size={24} className="opacity-80" />
              </div>
            </Link>
          </div>
        )}
      </section>

      {profile.role === "student" && coursesData.length > 0 && (
        <section className="section" style={{ marginTop: "32px" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: "bold", marginBottom: "16px" }}>수강 중인 과목 학습 관리 (스마트 로드맵)</h2>
          {coursesData.map((c) => (
            <div key={c.courseId} style={{ marginBottom: "24px" }}>
              <h3 style={{ fontSize: "1.1rem", fontWeight: "600", borderBottom: "2px solid var(--color-border)", paddingBottom: "8px" }}>{c.courseName}</h3>
              <WeeklyMissions 
                studentId={profile.id}
                courseId={c.courseId}
                currentWeek={c.currentWeek}
                initialGuide={c.initialGuide}
              />
            </div>
          ))}
        </section>
      )}
    </AppShell>
  );
}
