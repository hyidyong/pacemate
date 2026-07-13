import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { RoadmapExplorer } from "@/components/roadmap/roadmap-explorer";
import { Button } from "@/components/ui/button";
import { roadmapSemester, type RoadmapCourse } from "@/data/roadmap-explorer";
import { getStudentOnboardingProfile, type StudentOnboardingProfile } from "@/services/onboarding.service";
import { redirectNonStudent } from "@/services/role-guard.service";
import { getApprovedRoadmapCourses } from "@/services/roadmap-revisions.service";
import { getDemoProfile } from "@/services/session.service";
import { getStudentWeeklyProgressForStudent } from "@/services/student-weekly-progress.server";
import { StudentWeeklyProgressPreview } from "@/components/roadmap/student-weekly-progress-preview";

export const dynamic = "force-dynamic";

const studentTypeLabels: Record<string, string> = {
  freshman: "신입생",
  transfer: "편입생",
  cross_major: "타전공생",
  double_major: "복수전공생",
  current_student: "재학생",
};

function includesAny(source: string, values: string[]) {
  const normalizedSource = source.toLowerCase();
  return values.some((value) => value && normalizedSource.includes(value.toLowerCase()));
}

function personalizeCourses(courses: RoadmapCourse[], onboarding: StudentOnboardingProfile | null) {
  if (!onboarding) {
    return courses;
  }

  const interests = onboarding.interests ?? [];
  const weakBasics = onboarding.weak_basics ?? [];
  const completed = onboarding.completed_courses_text ?? "";

  return [...courses].sort((a, b) => {
    const score = (course: RoadmapCourse) => {
      const haystack = [
        course.name,
        course.category,
        course.shortReason,
        course.professor,
        ...course.basics,
        ...course.weeklyFocus,
      ].join(" ");

      let current = course.priority === "core" ? 8 : course.priority === "recommended" ? 5 : 2;
      if (includesAny(haystack, interests)) {
        current += 6;
      }
      if (course.basics.some((basic) => includesAny(basic, weakBasics))) {
        current += 7;
      }
      if (completed.includes(course.name) || completed.includes(course.code)) {
        current -= 12;
      }
      return current;
    };

    return score(b) - score(a);
  });
}

function getPersonalizedSummary(onboarding: StudentOnboardingProfile | null) {
  if (!onboarding) {
    return {
      studentType: roadmapSemester.studentType,
      semesterSummary: roadmapSemester.summary,
      notes: ["온보딩을 완료하면 관심 분야와 약한 기초에 맞춰 추천 순서를 조정합니다."],
    };
  }

  const typeText =
    onboarding.user_types?.map((type) => studentTypeLabels[type] ?? type).join(" · ") || "학생";
  const semesterText =
    onboarding.grade && onboarding.semester
      ? `${onboarding.grade}학년 ${onboarding.semester}학기`
      : "학기 정보 미입력";
  const notes = [
    onboarding.target_career ? `목표 진로: ${onboarding.target_career}` : null,
    onboarding.interests?.length ? `관심 분야: ${onboarding.interests.join(", ")}` : null,
    onboarding.weak_basics?.length ? `보강할 기초: ${onboarding.weak_basics.join(", ")}` : null,
  ].filter((item): item is string => Boolean(item));

  return {
    studentType: `${typeText} · ${semesterText}`,
    semesterSummary:
      notes[0] ?? "온보딩 입력값을 기준으로 추천 과목 순서와 학습 포인트를 조정했습니다.",
    notes: notes.length ? notes : ["온보딩 입력값을 기준으로 추천 과목 순서를 조정했습니다."],
  };
}

export default async function RoadmapPage() {
  const profile = await getDemoProfile();
  redirectNonStudent(profile);
  const [baseCourses, onboarding, weeklyProgress] = await Promise.all([
    getApprovedRoadmapCourses(),
    getStudentOnboardingProfile(profile),
    profile?.role === "student" ? getStudentWeeklyProgressForStudent(profile.id) : Promise.resolve(null),
  ]);
  const courses = personalizeCourses(baseCourses, onboarding);
  const personalized = getPersonalizedSummary(onboarding);

  return (
    <AppShell>
      <section className="screen-hero">
        <Link href="/dashboard" className="status-line">
          <ArrowLeft size={15} aria-hidden="true" />
          개인화 로드맵
        </Link>
        <h1>이번 학기 수강 로드맵</h1>
        <p>
          시간표에서 과목을 선택하면 추천 수강 순서, 필요한 기초 지식, 학습
          방법, 해당 수업별 공부 전략을 바로 확인합니다.
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

      <RoadmapExplorer
        courses={courses}
        semesterLabel={roadmapSemester.label}
        semesterSummary={personalized.semesterSummary}
        studentType={personalized.studentType}
        personalizationNotes={personalized.notes}
        totalCredit={roadmapSemester.totalCredit}
      />

      {weeklyProgress ? <StudentWeeklyProgressPreview preview={weeklyProgress} /> : null}
    </AppShell>
  );
}
