import { AppShell } from "@/components/layout/app-shell";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { sampleSyllabus } from "@/data/sample-syllabus";
import { getCourseSummaries } from "@/services/course.service";
import { RegisterCourseButton } from "@/components/courses/register-course-button";
import { FavoriteCourseButton } from "@/components/courses/favorite-course-button";
import { getFavoriteCourseIds } from "@/services/student-community.service";
import { redirectNonStudent } from "@/services/role-guard.service";
import { getDemoProfile } from "@/services/session.service";

export const dynamic = "force-dynamic";

type CoursesPageProps = {
  searchParams?: Promise<{
    q?: string;
  }>;
};

export default async function CoursesPage({ searchParams }: CoursesPageProps) {
  const profile = await getDemoProfile();
  redirectNonStudent(profile);
  const params = await searchParams;
  const query = params?.q?.trim() ?? "";
  const normalizedQuery = query.toLowerCase();
  const isStudent = profile?.role === "student";
  // Favorites depend only on the profile, not on the course list — fetch both
  // in one round trip instead of serializing them.
  const [courses, favoriteCourseIds] = await Promise.all([
    getCourseSummaries(),
    isStudent && profile ? getFavoriteCourseIds(profile.id) : Promise.resolve(new Set<string>()),
  ]);
  const sampleCourse = courses.find(
    (course) => course.code === sampleSyllabus.course.code,
  );
  const filteredCourses = normalizedQuery
    ? courses.filter((course) => {
        const searchableText = [
          course.name,
          course.code,
          course.description,
          course.prerequisite_text,
          course.category,
          course.id === sampleCourse?.id ? sampleSyllabus.course.professor : null,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return searchableText.includes(normalizedQuery);
      })
    : courses;

  return (
    <AppShell showAiTutorFab={false}>
      <section className="screen-hero">
        <Link href="/dashboard" className="status-line">
          <ArrowLeft size={15} aria-hidden="true" />
          과목 정보
        </Link>
        <h1>과목 정보</h1>
        <p>
          과목 소개, 학점, 선수 과목, 권장 학년, 교수, 강의계획서, 관련
          후기와 질문을 확인합니다.
        </p>
        <div className="actions">
          <Button asChild>
            <Link href="/reviews" data-testid="courses-primary-reviews">
              후기 화면 보기
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </section>
      <section className="section">
        <div className="section-header">
          <div>
            <h2>등록된 과목</h2>
            <p>
              Supabase에 연결된 과목 목록입니다. 마이페이지 시간표 등록과 커뮤니티 과목 선택에
              함께 사용됩니다.
            </p>
          </div>
        </div>
        <form action="/courses" className="course-search" role="search">
          <label className="sr-only" htmlFor="course-search-input">
            과목 검색
          </label>
          <div className="course-search-field">
            <Search size={18} aria-hidden="true" />
            <input
              id="course-search-input"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="과목명, 교수명, 과목 코드, 설명으로 검색"
            />
          </div>
          <Button type="submit">검색</Button>
          {query ? (
            <Button asChild variant="outline">
              <Link href="/courses">초기화</Link>
            </Button>
          ) : null}
        </form>
        {filteredCourses.length ? (
          <div className="card-grid">
            {filteredCourses.map((course) => (
            <Card key={course.id}>
              <CardHeader>
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <CardTitle>{course.name}</CardTitle>
                    <CardDescription>
                      {course.code} · {course.credit}학점 · {course.category ?? "분류 미정"}
                    </CardDescription>
                  </div>
                  {isStudent && (
                    <div className="flex shrink-0 items-center gap-2">
                      <FavoriteCourseButton
                        courseId={course.id}
                        initialFavorite={favoriteCourseIds.has(course.id)}
                      />
                      <RegisterCourseButton courseId={course.id} />
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <p className="body-copy">
                  {course.description ?? "강의계획서 정보가 등록되면 과목 설명이 표시됩니다."}
                </p>
                {course.prerequisite_text ? (
                  <p className="body-copy">선수/준비: {course.prerequisite_text}</p>
                ) : null}
                <div className="course-card-actions mt-4 flex gap-3 text-sm">
                  <Link href={`/courses/${course.id}`} className="text-primary hover:underline font-semibold">강의계획서 상세</Link>
                  <Link href={`/community?course=${course.id}`} className="text-primary hover:underline">커뮤니티</Link>
                  <Link href={`/reviews?course=${course.id}`} className="text-primary hover:underline">후기</Link>
                  <Link href="/roadmap" className="text-primary hover:underline">로드맵</Link>
                </div>
              </CardContent>
            </Card>
            ))}
          </div>
        ) : (
          <div className="course-empty-state">
            <p>{query ? "검색 결과가 없어요." : "아직 등록된 과목이 없습니다."}</p>
          </div>
        )}
      </section>
    </AppShell>
  );
}
