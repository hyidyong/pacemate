import type { CourseTermCompletionEligibilityReadResult } from "@/services/course-term-completion-eligibility.server";

const statusCopy = {
  eligible_for_completion: { label: "완료 근거 충족", tone: "emerald" },
  needs_review: { label: "복습 검토 필요", tone: "amber" },
  still_in_progress: { label: "학습 진행 중", tone: "blue" },
  insufficient_data: { label: "근거 데이터 부족", tone: "slate" },
} as const;

function errorMessage(code: string, courseName: string | null) {
  const label = courseName ?? "해당 과목";
  if (code === "unauthenticated") return "로그인이 필요합니다.";
  if (code === "forbidden") return "학생 계정에서만 확인할 수 있습니다.";
  if (code === "offering_not_found" || code === "term_not_found") {
    return `${label} 학기 완료 근거를 확인할 수 없습니다.`;
  }
  return "학기 완료 근거를 불러오지 못했습니다.";
}

export function CourseTermEligibilityCard({
  result,
  courseName,
}: {
  result: CourseTermCompletionEligibilityReadResult;
  courseName: string | null;
}) {
  if (!result.ok) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-live="polite">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">과목 · 학기 완료 근거</p>
        <p className="mt-3 text-sm text-slate-600">{errorMessage(result.error.code, courseName)}</p>
      </section>
    );
  }

  const { eligibility } = result;
  const copy = statusCopy[eligibility.status];
  const toneClass = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    blue: "border-blue-200 bg-blue-50 text-blue-800",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  }[copy.tone];
  const evidence = eligibility.evidence;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="course-term-eligibility-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-600">오늘의 과목 학기 근거</p>
          <h2 id="course-term-eligibility-title" className="mt-1 text-lg font-bold text-slate-900">{courseName ?? "해당 과목"}</h2>
          <p className="mt-1 text-sm text-slate-500">{result.semesterLabel}</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${toneClass}`}>{copy.label}</span>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Metric label="주간 근거" value={`${evidence.coveredWeekCount}/${evidence.expectedWeekCount}`} />
        <Metric label="승인 계획" value={`${evidence.approvedWeekCount}/${evidence.expectedWeekCount}`} />
        <Metric label="학생 기록" value={`${evidence.studentWeekCount}/${evidence.expectedWeekCount}`} />
        <Metric label="검토 필요" value={`${evidence.needsReviewWeekCount}주`} />
      </div>
      <p className="mt-4 text-xs leading-5 text-slate-500">
        진행 중 {evidence.inProgressWeekCount}주 · 미시작 {evidence.notStartedWeekCount}주 · 건너뜀 {evidence.skippedWeekCount}주
      </p>
      {eligibility.reasons.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
          {eligibility.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      )}
      <div className="mt-5 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">
        <p>이 결과는 해당 과목의 학기 학습 완료 근거입니다.</p>
        <p>졸업 가능 여부나 학점 취득을 확정하는 결과는 아닙니다.</p>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-slate-900">{value}</p>
    </div>
  );
}
