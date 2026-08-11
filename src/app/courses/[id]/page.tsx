import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, BookOpen } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { sampleSyllabus } from "@/data/sample-syllabus";
import { getCourseById } from "@/services/course.service";
import { RegisterCourseButton } from "@/components/courses/register-course-button";
import { FavoriteCourseButton } from "@/components/courses/favorite-course-button";
import { getFavoriteCourseIds } from "@/services/student-community.service";
import { redirectNonStudent } from "@/services/role-guard.service";
import { getDemoProfile } from "@/services/session.service";

type CourseDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export const dynamic = "force-dynamic";

export default async function CourseDetailPage({ params }: CourseDetailPageProps) {
  const profile = await getDemoProfile();
  redirectNonStudent(profile);
  
  const { id } = await params;
  const course = await getCourseById(id);

  if (!course) {
    notFound();
  }

  const isStudent = profile?.role === "student";
  const favoriteCourseIds = isStudent && profile
    ? await getFavoriteCourseIds(profile.id)
    : new Set<string>();

  // Use sample syllabus if it matches the code, otherwise use a generic display or partial data
  const isSample = course.code === sampleSyllabus.course.code;
  const syllabusData = isSample ? sampleSyllabus : null;

  return (
    <AppShell>
      <section className="screen-hero">
        <Link href="/courses" className="status-line">
          <ArrowLeft size={15} aria-hidden="true" />
          과목 목록으로 돌아가기
        </Link>
        <h1>{course.name}</h1>
        <p>
          {course.code} · {course.credit}학점 · {course.category ?? "분류 미정"}
        </p>
        <div className="actions">
          {isStudent && (
            <FavoriteCourseButton
              courseId={course.id}
              initialFavorite={favoriteCourseIds.has(course.id)}
            />
          )}
          {isStudent && <RegisterCourseButton courseId={course.id} />}
          <Button asChild variant="outline">
            <Link href={`/reviews?course=${course.id}`}>
              후기 보기
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/community?course=${course.id}`}>
              커뮤니티 보기
            </Link>
          </Button>
        </div>
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <h2>과목 기본 정보</h2>
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{course.name}</CardTitle>
            <CardDescription>
              {course.code} · {course.credit}학점
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="detail-grid">
              {[
                ["이수구분", course.category ?? syllabusData?.course.category ?? "미정"],
                ["과목 설명", course.description ?? syllabusData?.overview ?? "등록된 설명이 없습니다."],
                ["선수/준비", course.prerequisite_text ?? syllabusData?.prerequisites.join(", ") ?? "없음"],
              ].map(([label, value]) => (
                <div className="detail-item" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      {syllabusData ? (
        <section className="section">
          <div className="section-header">
            <div>
              <h2>강의계획서 상세</h2>
              <p>이 과목의 실제 강의계획서 데이터입니다.</p>
            </div>
          </div>
          <div className="card-grid">
            <Card>
              <CardHeader>
                <CardTitle>강의 정보</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="detail-grid">
                  {[
                    ["강의시간", syllabusData.course.schedule],
                    ["강의실", syllabusData.course.classroom],
                    ["수강대상", syllabusData.course.target],
                    ["담당교수", syllabusData.course.professor],
                    ["연구실", syllabusData.course.office],
                    ["이메일", syllabusData.course.email],
                  ].map(([label, value]) => (
                    <div className="detail-item" key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>평가 방식</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="score-list">
                  {syllabusData.evaluation.map((item) => (
                    <div className="score-row" key={item.label}>
                      <span>{item.label}</span>
                      <strong>{item.ratio}%</strong>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="week-card mt-6">
            <CardHeader>
              <CardTitle>주차별 강의계획</CardTitle>
              <CardDescription>16주차 기준 데이터</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="week-list">
                {syllabusData.weeks.map((week) => (
                  <li key={week.week}>
                    <span>{week.week}주차</span>
                    <p>{week.topic}</p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </section>
      ) : (
        <section className="section">
          <div className="community-empty">
            <BookOpen size={32} className="text-gray-300 mx-auto mb-4" />
            <p>이 과목에 등록된 강의계획서가 아직 없습니다.</p>
          </div>
        </section>
      )}
    </AppShell>
  );
}
