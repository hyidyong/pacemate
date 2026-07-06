import Link from "next/link";
import { ArrowLeft, UserRound } from "lucide-react";
import { CommunityBoard } from "@/components/community/community-board";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { redirectNonStudent } from "@/services/role-guard.service";
import { getDemoProfile } from "@/services/session.service";
import { getCommunityData } from "@/services/student-community.service";

type CommunityPageProps = {
  searchParams?: Promise<{
    course?: string;
    post?: string;
  }>;
};

export const dynamic = "force-dynamic";

export default async function CommunityPage({ searchParams }: CommunityPageProps) {
  const params = await searchParams;
  const profile = await getDemoProfile();
  redirectNonStudent(profile);
  const data = await getCommunityData(profile);

  return (
    <AppShell>
      <section className="screen-hero community-page-hero">
        <Link href="/dashboard" className="status-line">
          <ArrowLeft size={15} aria-hidden="true" />
          대학별 커뮤니티
        </Link>
        <h1>{data.schoolName}</h1>
        <p>
          대학 전체 게시판에서 시작하고, 내 시간표 과목이나 검색한 과목으로 좁혀
          질문·스터디·후기·공지를 확인합니다.
        </p>
        <div className="actions">
          <Button asChild>
            <Link href="/mypage" data-testid="community-mypage-link">
              <UserRound size={16} aria-hidden="true" />
              내 시간표 관리
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/chatbot">AI에게 먼저 묻기</Link>
          </Button>
        </div>
      </section>

      <CommunityBoard
        courses={data.courses}
        initialCourseId={params?.course}
        initialPostId={params?.post}
        initialPosts={data.posts}
        myCourses={data.myCourses}
        profileId={data.profile?.id}
        schoolName={data.schoolName}
      />
    </AppShell>
  );
}
