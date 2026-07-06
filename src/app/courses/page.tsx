import { AppShell } from "@/components/layout/app-shell";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
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
import { redirectNonStudent } from "@/services/role-guard.service";
import { getDemoProfile } from "@/services/session.service";

export const dynamic = "force-dynamic";

export default async function CoursesPage() {
  const profile = await getDemoProfile();
  redirectNonStudent(profile);
  const courses = await getCourseSummaries();
  const sampleCourse = courses.find(
    (course) => course.code === sampleSyllabus.course.code,
  );

  const isStudent = profile?.role === "student";

  return (
    <AppShell>
      <section className="screen-hero">
        <Link href="/" className="status-line">
          <ArrowLeft size={15} aria-hidden="true" />
          1단계 화면 뼈대
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
          <Button asChild variant="outline">
            <Link href="/">전체 화면 지도</Link>
          </Button>
        </div>
      </section>
      <section className="section">
        <Card>
          <CardHeader>
            <CardTitle>현재 상태</CardTitle>
            <CardDescription>
              과목 데이터 구조와 관리자 입력 관리는 2단계 Supabase 스키마 이후
              붙입니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="screen-list">
              {[
                "courses, course_professors, syllabi 테이블과 연결합니다.",
                "관리자/조교 입력 화면과 CSV 업로드 진입점을 준비합니다.",
                "과목 상세에서 후기, 질문, 상담 가능 시간을 이어 보여줍니다.",
              ].map((item) => (
                <li key={item}>
                  <p>{item}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
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
        <div className="card-grid">
          {courses.map((course) => (
            <Card key={course.id}>
              <CardHeader>
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <CardTitle>{course.name}</CardTitle>
                    <CardDescription>
                      {course.code} · {course.credit}학점 · {course.category ?? "분류 미정"}
                    </CardDescription>
                  </div>
                  {isStudent && <RegisterCourseButton courseId={course.id} />}
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
      </section>
    </AppShell>
  );
}
