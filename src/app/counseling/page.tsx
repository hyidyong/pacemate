import { CounselingWorkspace } from "@/components/counseling/counseling-workspace";
import { AppShell } from "@/components/layout/app-shell";
import { DataErrorNotice } from "@/components/ui/data-error-notice";
import { getCounselingPageData } from "@/services/counseling.service";
import { redirectNonStudent } from "@/services/role-guard.service";
import { getDemoProfile } from "@/services/session.service";

export const dynamic = "force-dynamic";

export default async function CounselingPage() {
  const profile = await getDemoProfile();
  redirectNonStudent(profile);
  // KI-003: a failed read must not render as "no slots / no professors".
  let loadFailed = false;
  const data = await getCounselingPageData(profile).catch((error) => {
    console.error("Counseling page data could not be loaded", error);
    loadFailed = true;
    return { availableSlots: [], courses: [], professors: [], requests: [] };
  });

  return (
    <AppShell>
      <section className="screen-hero">
        <span className="status-line">상담 예약</span>
        <h1>과목이나 교수님을 먼저 고르고 예약해요.</h1>
        <p>
          과목별 예약은 내 시간표 과목에서 담당 교수를 먼저 확인하고, 교수별 검색은 교수 프로필을
          확인한 뒤 가능한 시간만 선택합니다.
        </p>
      </section>
      {loadFailed ? <DataErrorNotice label="상담 정보를 불러오지 못했습니다." /> : null}
      <CounselingWorkspace
        availableSlots={data.availableSlots}
        courses={data.courses}
        professors={data.professors}
        requests={data.requests}
      />
    </AppShell>
  );
}
