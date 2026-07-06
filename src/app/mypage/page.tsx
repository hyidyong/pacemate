import Link from "next/link";
import { ArrowLeft, CircleHelp, UserRound } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { MyPagePlanner } from "@/components/mypage/my-page-planner";
import { Button } from "@/components/ui/button";
import { clearDemoSession } from "@/services/demo-auth.service";
import { redirectNonStudent } from "@/services/role-guard.service";
import { getDemoProfile } from "@/services/session.service";
import { getMyPageData } from "@/services/student-community.service";
import { StudentOnboardingForm } from "@/components/onboarding/student-onboarding-form";

export const dynamic = "force-dynamic";

export default async function MyPage() {
  const profile = await getDemoProfile();
  redirectNonStudent(profile);
  const data = await getMyPageData(profile);

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

      <MyPagePlanner
        courses={data.courses}
        myCourses={data.myCourses}
        myPosts={data.myPosts}
        scrapedPosts={data.scrapedPosts}
        commentedPosts={data.commentedPosts}
        likedPosts={data.likedPosts}
      />

      {profile && data.savedProfile && (
        <section className="section" style={{ marginTop: "32px", padding: "0 1rem" }}>
          <details className="mypage-settings-details" style={{ backgroundColor: "var(--color-surface)", padding: "1.5rem", borderRadius: "12px", border: "1px solid var(--color-border)", cursor: "pointer" }}>
            <summary style={{ fontWeight: "bold", fontSize: "1.1rem", display: "flex", alignItems: "center", gap: "8px" }}>
              내 진로/설정 수정
            </summary>
            <div style={{ marginTop: "1rem", cursor: "default" }}>
              <StudentOnboardingForm 
                error={null}
                savedProfile={data.savedProfile}
                returnTo="/mypage"
              />
            </div>
          </details>
        </section>
      )}

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
