import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MapPin,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { RoadmapFeedbackForm } from "@/components/roadmap/roadmap-feedback-form";
import { Button } from "@/components/ui/button";
import { roadmapCourses, roadmapSemester } from "@/data/roadmap-explorer";
import { getStudentOnboardingProfile, type StudentOnboardingProfile } from "@/services/onboarding.service";
import { redirectNonStudent } from "@/services/role-guard.service";
import { getApprovedRoadmapCourses } from "@/services/roadmap-revisions.service";
import { getDemoProfile } from "@/services/session.service";

type RoadmapCoursePageProps = {
  params: Promise<{
    courseId: string;
  }>;
};

export function generateStaticParams() {
  return roadmapCourses.map((course) => ({
    courseId: course.id,
  }));
}

export const dynamic = "force-dynamic";

function includesAny(source: string, values: string[]) {
  const normalizedSource = source.toLowerCase();
  return values.some((value) => value && normalizedSource.includes(value.toLowerCase()));
}

function getPersonalActionItems(
  course: (typeof roadmapCourses)[number],
  onboarding: StudentOnboardingProfile | null,
) {
  if (!onboarding) {
    return [
      "온보딩에서 관심 분야와 약한 기초를 입력하면 이 과목에 맞춘 보강 순서를 보여드려요.",
      "강의계획서 목차를 먼저 훑고, 모르는 개념은 AI 튜터에게 짧게 질문해 보세요.",
    ];
  }

  const items: string[] = [];
  const weakBasics = onboarding.weak_basics ?? [];
  const interests = onboarding.interests ?? [];
  const completed = onboarding.completed_courses_text ?? "";

  const matchedBasics = course.basics.filter((basic) => includesAny(basic, weakBasics));
  if (matchedBasics.length) {
    items.push(`${matchedBasics[0]} 기초를 먼저 보강하고 강의 목차를 읽는 순서가 좋아요.`);
  }

  const haystack = [course.name, course.category, course.shortReason, ...course.weeklyFocus].join(" ");
  if (includesAny(haystack, interests)) {
    items.push("입력한 관심 분야와 맞닿아 있어 사례형 질문과 판례 정리를 같이 쌓아두면 효율이 좋아요.");
  }

  if (completed.includes(course.name) || completed.includes(course.code)) {
    items.push("이미 이수한 과목으로 보입니다. 재수강이 아니라면 연결 과목이나 심화 학습 자료 위주로 확인하세요.");
  }

  if (onboarding.target_career) {
    items.push(`${onboarding.target_career} 목표와 연결되는 쟁점을 주차별 키워드에 표시해 두세요.`);
  }

  return items.length
    ? items
    : ["현재 입력값 기준으로는 기본 추천 순서를 따르되, 첫 2주 동안 기초 용어 정리 시간을 따로 잡는 게 좋습니다."];
}

export default async function RoadmapCoursePage({
  params,
}: RoadmapCoursePageProps) {
  const profile = await getDemoProfile();
  redirectNonStudent(profile);
  const { courseId } = await params;
  const [courses, onboarding] = await Promise.all([
    getApprovedRoadmapCourses(),
    getStudentOnboardingProfile(profile),
  ]);
  const course = courses.find((item) => item.id === courseId) ?? null;

  if (!course) {
    notFound();
    throw new Error("Course not found");
  }

  const personalActionItems = getPersonalActionItems(course, onboarding);

  return (
    <AppShell>
      <section className="screen-hero roadmap-course-hero">
        <Link href="/roadmap" className="status-line">
          <ArrowLeft size={15} aria-hidden="true" />
          시간표로 돌아가기
        </Link>
        <h1>{course.name}</h1>
        <p>
          {roadmapSemester.label} 기준으로 이 과목을 듣기 전에 확인할 지식,
          추천 수강 순서, 학습 방법을 한 화면에서 정리합니다.
        </p>
        <div className="actions">
          <Button asChild>
            <Link href="/chatbot" data-testid="roadmap-detail-chatbot-link">
              AI에게 질문하기
              <Sparkles size={16} aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/courses">강의계획서 보기</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/reviews?course=${course.id}`}>후기 보기</Link>
          </Button>
        </div>
      </section>

      <section className="section roadmap-detail-page">
        <aside className="roadmap-detail-side">
          <div className="roadmap-detail-side-card">
            <span>{course.code}</span>
            <strong>{course.name}</strong>
            <p>{course.shortReason}</p>
            <div className="roadmap-course-facts">
              <span>
                <CalendarDays aria-hidden="true" />
                {course.category} · {course.credit}학점
              </span>
              <span>
                <Clock3 aria-hidden="true" />
                {course.dayLabel} {course.timeLabel}
              </span>
              <span>
                <MapPin aria-hidden="true" />
                {course.classroom} · {course.professor}
              </span>
            </div>
          </div>
        </aside>

        <article className="roadmap-detail-main" data-testid="roadmap-course-detail">
          <section className="roadmap-detail-section">
            <h2>추천 수강 순서</h2>
            <ol className="roadmap-phase-list">
              {course.order.map((phase) => (
                <li key={phase.label}>
                  <span>{phase.label}</span>
                  <div>
                    <strong>{phase.title}</strong>
                    <p>{phase.reason}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="roadmap-personal-action-card">
            <div>
              <Sparkles aria-hidden="true" />
              <h2>나에게 맞춘 학습 액션</h2>
            </div>
            <ul>
              {personalActionItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="roadmap-detail-section">
            <h2>알고 있어야 할 기초 지식</h2>
            <div className="roadmap-tags">
              {course.basics.map((basic) => (
                <span key={basic}>{basic}</span>
              ))}
            </div>
          </section>

          <div className="roadmap-method-grid">
            <section className="roadmap-method-card">
              <div className="roadmap-method-title">
                <span>
                  <BookOpenCheck aria-hidden="true" />
                </span>
                <h2>학습 방법</h2>
              </div>
              <ul>
                {course.generalStudyMethod.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>

            <section className="roadmap-method-card">
              <div className="roadmap-method-title">
                <span>
                  <CheckCircle2 aria-hidden="true" />
                </span>
                <h2>해당 수업 학습 방법</h2>
              </div>
              <ul>
                {course.courseStudyMethod.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          </div>

          <section className="roadmap-detail-section">
            <h2>이번 학기 집중 키워드</h2>
            <div className="roadmap-focus-strip">
              {course.weeklyFocus.map((focus) => (
                <span key={focus}>{focus}</span>
              ))}
            </div>
          </section>

          <RoadmapFeedbackForm
            courseCode={course.code}
            courseId={course.id}
            courseName={course.name}
          />
        </article>
      </section>
    </AppShell>
  );
}
