import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { WeeklyPlanReviewEditor } from "@/components/professor/weekly-plan-review-editor";
import { getWeeklyPlanDraftsForProfessorSession } from "@/services/weekly-roadmap.server";
import { getDemoProfile, getRoleHomePath } from "@/services/session.service";
import type { WeeklyPlanReview } from "@/types/weekly-roadmap";

export const dynamic = "force-dynamic";

export default async function WeeklyPlanPreviewPage({
  searchParams,
}: {
  searchParams?: Promise<{ courseId?: string; approval?: "approved" | "already-approved" | "error" }>;
}) {
  const profile = await getDemoProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "professor") redirect(getRoleHomePath(profile.role));

  const params = await searchParams;
  const selectedCourseId = typeof params?.courseId === "string" ? params.courseId : "";
  let drafts: WeeklyPlanReview[] = [];
  let loadError = false;

  try {
    drafts = await getWeeklyPlanDraftsForProfessorSession(profile, selectedCourseId || undefined);
  } catch {
    loadError = true;
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
        <section className="mb-8">
          <p className="text-sm font-semibold text-blue-600">교수 검토 공간</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">주간 계획 초안 검토</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
            교수 승인 전 초안입니다. 내용을 검토 및 수정하신 후 승인하시면 주간 계획(1~15주차)이 확정되어 학생들에게 공개됩니다.
          </p>
        </section>

        {loadError ? (
          <div role="alert" className="rounded-2xl bg-rose-50 p-5 text-sm leading-6 text-rose-900 shadow-sm">
            초안 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
          </div>
        ) : drafts.length === 0 ? (
          <div className="rounded-2xl bg-white p-6 text-sm text-slate-600 shadow-sm">검토할 주간 계획 초안이 없습니다.</div>
        ) : (
          <WeeklyPlanReviewEditor drafts={drafts} approvalState={params?.approval} />
        )}
      </div>
    </AppShell>
  );
}
