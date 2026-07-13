import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getWeeklyPlanDraftsForProfessorSession } from "@/services/weekly-roadmap.server";
import { approveWeeklyPlan } from "@/services/weekly-plan-approval.actions";
import { getDemoProfile, getRoleHomePath } from "@/services/session.service";
import type { WeeklyPlanConfidence, WeeklyPlanDraft, WeeklyPlanReview } from "@/types/weekly-roadmap";

export const dynamic = "force-dynamic";

function confidenceCounts(draft: WeeklyPlanDraft): Record<WeeklyPlanConfidence, number> {
  return draft.weeks.reduce(
    (counts, week) => {
      counts[week.confidence] += 1;
      return counts;
    },
    { high: 0, medium: 0, low: 0 } as Record<WeeklyPlanConfidence, number>,
  );
}

function DraftCard({ draft }: { draft: WeeklyPlanReview }) {
  const counts = confidenceCounts(draft);

  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <header className="border-b border-slate-100 pb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">2026-2 · Draft preview</p>
            <h2 className="mt-2 text-xl font-bold text-slate-950">{draft.courseName}</h2>
            <p className="mt-1 text-sm text-slate-500">담당 교수: {draft.professorName}</p>
          </div>
          <div className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">Draft · 교수 미확인</div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-xl bg-emerald-50 px-2 py-2 text-emerald-800"><strong className="block text-lg">{counts.high}</strong>High</div>
          <div className="rounded-xl bg-sky-50 px-2 py-2 text-sky-800"><strong className="block text-lg">{counts.medium}</strong>Medium</div>
          <div className="rounded-xl bg-amber-100 px-2 py-2 text-amber-900"><strong className="block text-lg">{counts.low}</strong>Low</div>
        </div>
      </header>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
        <div>
          <strong className="block text-slate-900">{draft.approvalStatus === "approved" ? "15주 승인 완료" : "15주 draft 검토 필요"}</strong>
          <span className="text-xs text-slate-500">저장된 주차: {draft.persistedWeekCount} / 15</span>
        </div>
        {draft.approvalStatus === "draft" ? (
          <form action={approveWeeklyPlan}>
            <input name="offeringId" type="hidden" value={draft.offeringId} />
            <button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-800" type="submit">
              15주 승인
            </button>
          </form>
        ) : (
          <span className="rounded-xl bg-emerald-100 px-3 py-2 text-xs font-bold text-emerald-800">중복 승인 차단</span>
        )}
      </div>

      <div className="mt-5 space-y-3">
        {draft.warnings.map((warning) => (
          <p key={warning} className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">주의: {warning}</p>
        ))}
      </div>

      <ol className="mt-6 space-y-3" aria-label={`${draft.courseName} 주차별 초안`}>
        {draft.weeks.map((week) => {
          const isLowConfidence = week.confidence === "low";
          return (
            <li key={week.weekNumber} className={`rounded-2xl border p-4 ${isLowConfidence ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50/60"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">{week.weekNumber}</span>
                  <div>
                    <h3 className="font-semibold text-slate-900">{week.title}</h3>
                    <p className="mt-1 text-sm text-slate-600">{week.topics.join(" · ")}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
                  <span className="rounded-full bg-white px-2 py-1 text-slate-600">{week.activityType}</span>
                  <span className={`rounded-full px-2 py-1 ${isLowConfidence ? "bg-amber-200 text-amber-900" : "bg-white text-slate-600"}`}>{week.confidence}</span>
                  {week.isAssessment ? <span className="rounded-full bg-rose-100 px-2 py-1 text-rose-700">assessment</span> : null}
                </div>
              </div>
              <p className="mt-3 border-t border-slate-200/80 pt-3 text-xs leading-5 text-slate-500">근거: {week.sourceNote}</p>
            </li>
          );
        })}
      </ol>
    </article>
  );
}

export default async function WeeklyPlanPreviewPage() {
  const profile = await getDemoProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "professor") redirect(getRoleHomePath(profile.role));

  let drafts: WeeklyPlanReview[] = [];
  let loadError = false;

  try {
    drafts = await getWeeklyPlanDraftsForProfessorSession();
  } catch {
    loadError = true;
  }

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
        <section className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">주간 계획 초안 검토</h1>
        </section>

        <div role="alert" className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          <strong>교수 승인 전 초안입니다.</strong> 승인 전에는 학생에게 공개되지 않으며, 승인 시 기존 `course_weekly_plans` 구조에 1~15주 row를 저장합니다. 승인 상태는 `review_required`와 `professor_confirmed` 조합으로 표시합니다.
        </div>

        {loadError ? (
          <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">초안 데이터를 불러오지 못했습니다. 내부 검토를 계속할 수 없습니다.</div>
        ) : drafts.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">검토할 담당 과목 초안이 없습니다</div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-2">{drafts.map((draft) => <DraftCard key={draft.offeringId} draft={draft} />)}</div>
        )}
      </main>
    </AppShell>
  );
}
