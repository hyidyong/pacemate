import Link from "next/link";
import { ArrowLeft, CircleHelp, UserRound } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { MyPagePlanner } from "@/components/mypage/my-page-planner";
import { Button } from "@/components/ui/button";
import { clearDemoSession } from "@/services/demo-auth.service";
import { redirectNonStudent } from "@/services/role-guard.service";
import { getDemoProfile } from "@/services/session.service";
import { getMyPageData } from "@/services/student-community.service";
import { DataErrorNotice } from "@/components/ui/data-error-notice";

export const dynamic = "force-dynamic";

export default async function MyPage() {
  const profile = await getDemoProfile();
  redirectNonStudent(profile);
  // KI-003: a failed read must not render as a brand-new empty account.
  let loadFailed = false;
  const data = await getMyPageData(profile).catch((error) => {
    console.error("My page data could not be loaded", error);
    loadFailed = true;
    return {
      schoolName: "계명대학교",
      profile,
      courses: [],
      myCourses: [],
      myPosts: [],
      scrapedPosts: [],
      commentedPosts: [],
      likedPosts: [],
    };
  });

  return (
    <AppShell>
      <section className="screen-hero mypage-hero">
        <Link href="/dashboard" className="status-line">
          <ArrowLeft size={15} aria-hidden="true" />
          개인 공간
        </Link>
        <h1>마이페이지</h1>
        <p>
          {data.schoolName} 기준으로 내 시간표와 즐겨찾기 과목을 관리하고, 각 과목
          커뮤니티로 바로 이동합니다.
        </p>
        {!profile ? (
          <div className="actions">
            <Button asChild>
              <Link href="/login">로그인하고 시간표 만들기</Link>
            </Button>
          </div>
        ) : (
          <div className="mypage-profile-strip">
            <span>
              <UserRound size={16} aria-hidden="true" />
              {profile.name}
            </span>
            <span>{profile.identifier}</span>
            <span>{profile.role}</span>
          </div>
        )}
      </section>

      {loadFailed ? <DataErrorNotice label="마이페이지 데이터를 불러오지 못했습니다." /> : null}
      <MyPagePlanner
        courses={data.courses}
        myCourses={data.myCourses}
        myPosts={data.myPosts}
        scrapedPosts={data.scrapedPosts}
        commentedPosts={data.commentedPosts}
        likedPosts={data.likedPosts}
      />

      <div className="mypage-support-link">
        <Link href="/support">
          <CircleHelp size={16} aria-hidden="true" />
          문의하기
        </Link>
      </div>
      {profile ? (
        <form action={clearDemoSession} className="mypage-logout-form">
          <button type="submit">로그아웃</button>
        </form>
      ) : null}
    </AppShell>
  );
}
