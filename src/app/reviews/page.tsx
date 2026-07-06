import Link from "next/link";
import { ArrowLeft, MessageSquareText } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { ReviewsBoard } from "@/components/reviews/reviews-board";
import { Button } from "@/components/ui/button";
import { getCourseSummaries } from "@/services/course.service";
import { redirectNonStudent } from "@/services/role-guard.service";
import { getCourseReviews } from "@/services/reviews.service";
import { getDemoProfile } from "@/services/session.service";

export const dynamic = "force-dynamic";

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams?: Promise<{ course?: string }>;
}) {
  const profile = await getDemoProfile();
  redirectNonStudent(profile);
  const params = await searchParams;
  const [courses, reviews] = await Promise.all([
    getCourseSummaries(),
    getCourseReviews(),
  ]);

  return (
    <AppShell>
      <section className="screen-hero">
        <Link href="/courses" className="status-line">
          <ArrowLeft size={15} aria-hidden="true" />
          과목 정보
        </Link>
        <h1>수강 후기</h1>
        <p>
          과목별 난이도, 학습량, 평가 방식, 수강 팁을 모아 보고 내 경험도 짧게 남깁니다.
        </p>
        <div className="actions">
          <Button asChild variant="outline">
            <Link href="/community">
              커뮤니티 보기
              <MessageSquareText size={16} aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </section>

      <ReviewsBoard courses={courses} initialCourseId={params?.course} reviews={reviews} />
    </AppShell>
  );
}
