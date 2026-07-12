import type {
  ProfessorCourseProgressReport,
  ProfessorCourseProgressReportResult,
  ProfessorCourseProgressStatus,
} from "@/types/professor-course-progress-report";

type ProfessorCourseProgressReportError = Extract<
  ProfessorCourseProgressReportResult,
  { ok: false }
>["error"];

type ProfessorCourseProgressReportViewProps = {
  report: ProfessorCourseProgressReport;
  error: ProfessorCourseProgressReportError | null;
};

const STATUS_META: readonly {
  key: ProfessorCourseProgressStatus;
  label: string;
  className: string;
}[] = [
  { key: "not_started", label: "미시작", className: "bg-slate-100 text-slate-700" },
  { key: "in_progress", label: "진행 중", className: "bg-blue-50 text-blue-700" },
  { key: "completed", label: "완료", className: "bg-emerald-50 text-emerald-700" },
  { key: "needs_review", label: "검토 필요", className: "bg-amber-50 text-amber-700" },
];

function formatLastActivity(value: string | null): string {
  if (value === null) {
    return "활동 기록 없음";
  }

  return new Date(value).toLocaleString("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function ProfessorCourseProgressReportView({
  report,
  error,
}: ProfessorCourseProgressReportViewProps) {
  if (error) {
    return (
      <section className="professor-panel" aria-live="polite">
        <div className="community-section-heading">
          <h2>과목 진행 현황</h2>
        </div>
        <div className="community-empty mt-4">
          <p>학습 리포트를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
        </div>
      </section>
    );
  }

  if (report.offerings.length === 0) {
    return (
      <section className="professor-panel" aria-live="polite">
        <div className="community-section-heading">
          <h2>과목 진행 현황</h2>
        </div>
        <div className="community-empty mt-4">
          <p>확인할 수 있는 과목 진행 데이터가 없습니다.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="professor-panel" aria-labelledby="professor-course-progress-report-title">
      <div className="community-section-heading">
        <div>
          <h2 id="professor-course-progress-report-title">과목 진행 현황</h2>
          <p className="mt-1 text-sm font-normal text-slate-500">
            담당 과목의 학습 상태와 최근 활동을 확인합니다.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-5">
        {report.offerings.map((offering, offeringIndex) => (
          <article
            key={offering.offeringId}
            className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-600">
                  담당 강의 {offeringIndex + 1}
                </p>
                <h3 className="mt-1 text-lg font-bold text-slate-900">강의 {offeringIndex + 1}</h3>
              </div>
              <div className="rounded-xl bg-white px-3 py-2 text-right shadow-sm ring-1 ring-slate-200/70">
                <p className="text-xs text-slate-500">전체 학생 수</p>
                <p className="mt-1 text-xl font-bold text-slate-900">{offering.totalStudentCount}명</p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {STATUS_META.map((status) => (
                <div key={status.key} className={`rounded-xl px-3 py-3 ${status.className}`}>
                  <p className="text-xs font-medium">{status.label}</p>
                  <p className="mt-1 text-lg font-bold">{offering.statusCounts[status.key]}명</p>
                </div>
              ))}
            </div>

            {offering.students.length > 0 ? (
              <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="hidden grid-cols-[minmax(6rem,1fr)_minmax(8rem,1.2fr)_minmax(7rem,1fr)_minmax(10rem,1.4fr)] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500 sm:grid">
                  <span>학생</span>
                  <span>마지막 완료 주차</span>
                  <span>상태</span>
                  <span>마지막 활동</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {offering.students.map((student, studentIndex) => (
                    <div
                      key={`${student.offeringId}-${student.studentId}`}
                      className="grid gap-3 px-4 py-3 text-sm sm:grid-cols-[minmax(6rem,1fr)_minmax(8rem,1.2fr)_minmax(7rem,1fr)_minmax(10rem,1.4fr)] sm:items-center"
                    >
                      <div className="font-semibold text-slate-800">학생 {studentIndex + 1}</div>
                      <div>
                        <span className="text-xs text-slate-500 sm:hidden">마지막 완료 주차 </span>
                        <span className="text-slate-700">
                          {student.lastCompletedWeek === null
                            ? "기록 없음"
                            : `${student.lastCompletedWeek}주`}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-slate-500 sm:hidden">상태 </span>
                        <span className="text-slate-700">
                          {STATUS_META.find((status) => status.key === student.status)?.label}
                        </span>
                      </div>
                      <div className="text-slate-600">
                        <span className="text-xs text-slate-500 sm:hidden">마지막 활동 </span>
                        {formatLastActivity(student.lastActivityAt)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
                아직 기록된 학생 진행 현황이 없습니다.
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
