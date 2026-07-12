import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { listWeeklyPlanDrafts } from "@/services/weekly-plan-draft.server";
import { getDemoProfile, getRoleHomePath } from "@/services/session.service";
import type { WeeklyPlanConfidence, WeeklyPlanDraft } from "@/types/weekly-roadmap";

export const dynamic = "force-dynamic";

const offeringOrder = [
  "d0761612-d2db-413a-a800-1d554a6876eb",
  "228bb6cc-497c-4065-bf83-c9b0d906812c",
] as const;

function confidenceCounts(draft: WeeklyPlanDraft): Record<WeeklyPlanConfidence, number> {
  return draft.weeks.reduce(
    (counts, week) => {
      counts[week.confidence] += 1;
      return counts;
    },
    { high: 0, medium: 0, low: 0 } as Record<WeeklyPlanConfidence, number>,
  );
}

function DraftCard({ draft }: { draft: WeeklyPlanDraft }) {
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

  let drafts: WeeklyPlanDraft[] = [];
  let loadError = false;

  try {
      const availableDrafts = listWeeklyPlanDrafts();
      drafts = offeringOrder
        .map((offeringId) => availableDrafts.find((draft) => draft.offeringId === offeringId) ?? null)
        .filter((draft): draft is WeeklyPlanDraft => draft !== null);
  } catch {
    loadError = true;
  }

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
        <section className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">Professor workspace</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">주간 계획 초안 검토</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">2026-2 syllabus 기반 초안을 교수·내부 운영자만 읽기 전용으로 검토하는 화면입니다.</p>
        </section>

        <div role="alert" className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          <strong>교수 승인 전 초안입니다.</strong> 이 내용은 정식 학생 로드맵이 아니며, 승인·저장·course_weekly_plans 동기화 기능이 없습니다. 교수 확인 여부: <strong>미확인 (verifiedByProfessor=false)</strong>
        </div>

        {loadError ? (
          <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">초안 데이터를 불러오지 못했습니다. 내부 검토를 계속할 수 없습니다.</div>
        ) : drafts.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">검토 가능한 초안이 없습니다.</div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-2">{drafts.map((draft) => <DraftCard key={draft.offeringId} draft={draft} />)}</div>
        )}
      </main>
    </AppShell>
  );
}
