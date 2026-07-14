"use client";

import { useState } from "react";
import { BarChart3, CircleHelp, MessageSquareText, Sparkles, UsersRound, X } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  ProfessorAnonymousWeeklyAggregate,
  ProfessorAnonymousWeeklyAggregateReport,
  ProfessorAnonymousWeeklyAggregateResult,
} from "@/types/professor-anonymous-weekly-aggregate";
import type {
  ProfessorCourseProgressReport,
  ProfessorCourseProgressReportResult,
  ProfessorCourseProgressStatus,
} from "@/types/professor-course-progress-report";

type ProfessorCourseProgressReportError = Extract<
  ProfessorCourseProgressReportResult,
  { ok: false }
>["error"];

type ProfessorAnonymousWeeklyAggregateError = Extract<
  ProfessorAnonymousWeeklyAggregateResult,
  { ok: false }
>["error"];

type ProfessorCourseProgressReportViewProps = {
  report: ProfessorCourseProgressReport;
  error: ProfessorCourseProgressReportError | null;
  anonymousAggregateReport: ProfessorAnonymousWeeklyAggregateReport;
  anonymousAggregateError: ProfessorAnonymousWeeklyAggregateError | null;
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

function groupAnonymousAggregates(aggregates: ProfessorAnonymousWeeklyAggregate[]) {
  const groups = new Map<string, ProfessorAnonymousWeeklyAggregate[]>();

  for (const aggregate of aggregates) {
    const current = groups.get(aggregate.offeringId);
    if (current) {
      current.push(aggregate);
    } else {
      groups.set(aggregate.offeringId, [aggregate]);
    }
  }

  return [...groups.entries()].map(([offeringId, weeks]) => ({
    offeringId,
    courseName: weeks[0]?.courseName ?? "담당 과목",
    weeks,
  }));
}

type DifficultyChartRow = {
  name: string;
  concept: string;
  high: number;
  mid: number;
  low: number;
  questions: number;
};

const DEMO_CHART_ROWS: DifficultyChartRow[] = [
  { name: "1주", concept: "핵심 개념 소개", high: 18, mid: 52, low: 30, questions: 2 },
  { name: "2주", concept: "기초 이론 적용", high: 32, mid: 48, low: 20, questions: 4 },
  { name: "3주", concept: "사례 분석", high: 46, mid: 39, low: 15, questions: 7 },
  { name: "4주", concept: "심화 쟁점", high: 68, mid: 24, low: 8, questions: 11 },
  { name: "5주", concept: "종합 문제 해결", high: 54, mid: 34, low: 12, questions: 8 },
  { name: "6주", concept: "중간 복습", high: 27, mid: 46, low: 27, questions: 3 },
];

const DEMO_PROFESSOR_MEMOS = [
  "4주차 심화 쟁점의 사례를 한 번 더 설명해 주시면 좋겠습니다.",
  "판례와 기본 개념을 연결하는 연습 문제를 추가로 받고 싶습니다.",
  "5주차 종합 문제 풀이 순서를 수업에서 다시 확인하고 싶습니다.",
];

function toDifficultyChartRows(aggregates: ProfessorAnonymousWeeklyAggregate[]): DifficultyChartRow[] {
  return aggregates
    .filter((aggregate) => !aggregate.suppressed && aggregate.difficultyResponseCount > 0)
    .map((aggregate) => ({
      name: `${aggregate.weekNumber}주`,
      concept: aggregate.weeklyTitle,
      high: aggregate.difficultyPercentages.HIGH,
      mid: aggregate.difficultyPercentages.MID,
      low: aggregate.difficultyPercentages.LOW,
      questions: aggregate.professorMemos.length,
    }));
}

function AnonymousAggregateSection({
  report,
  error,
}: {
  report: ProfessorAnonymousWeeklyAggregateReport;
  error: ProfessorAnonymousWeeklyAggregateError | null;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const groups = groupAnonymousAggregates(report.aggregates);
  const allAggregates = groups.flatMap((group) => group.weeks);
  const realChartRows = toDifficultyChartRows(allAggregates);
  const realProfessorMemos = allAggregates.flatMap((aggregate) => aggregate.professorMemos);
  const hasRealDifficulty = realChartRows.length > 0;
  const hasRealFeedback = hasRealDifficulty || realProfessorMemos.length > 0;
  const chartRows = hasRealDifficulty ? realChartRows : DEMO_CHART_ROWS;
  const professorMemos = hasRealFeedback ? realProfessorMemos : DEMO_PROFESSOR_MEMOS;
  const hardest = chartRows.reduce((current, row) => row.high > current.high ? row : current, chartRows[0]);
  const responseCount = hasRealFeedback
    ? allAggregates.reduce((sum, aggregate) => sum + aggregate.difficultyResponseCount, 0)
    : 32;

  return (
    <section
      className="mt-8 border-t border-slate-200 pt-6"
      aria-labelledby="professor-anonymous-weekly-aggregate-title"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Learning pulse</p>
          <h2 id="professor-anonymous-weekly-aggregate-title" className="mt-1 text-2xl font-bold text-slate-900">
            학생 학습 체감 리포트
          </h2>
          <p className="mt-2 text-sm text-slate-500">난이도 분포와 학생이 직접 전달한 질문만 안전하게 취합합니다.</p>
        </div>
        <button
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 hover:shadow-md"
          onClick={() => setDetailOpen(true)}
          type="button"
        >
          <Sparkles size={16} aria-hidden="true" />
          데모 리포트 상세 보기
        </button>
      </div>

      {error ? (
        <div className="mt-5 rounded-2xl bg-amber-50 px-5 py-4 text-sm text-amber-800 shadow-sm">
          실데이터 집계를 불러오지 못해 예시 리포트를 표시합니다.
        </div>
      ) : !hasRealFeedback ? (
        <div className="mt-5 rounded-2xl bg-blue-50/80 px-5 py-4 text-sm text-blue-800 shadow-sm">
          수집된 학생 피드백이 아직 부족합니다. 예시 데이터를 확인해 보세요.
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl bg-rose-50 p-4 shadow-sm">
          <BarChart3 className="text-rose-500" size={20} aria-hidden="true" />
          <p className="mt-3 text-xs font-semibold text-rose-700">가장 어려웠던 개념</p>
          <p className="mt-1 line-clamp-2 font-bold text-slate-900">{hardest?.concept ?? "응답 대기 중"}</p>
          <p className="mt-1 text-xs text-slate-500">어려움 {hardest?.high ?? 0}%</p>
        </article>
        <article className="rounded-2xl bg-blue-50 p-4 shadow-sm">
          <MessageSquareText className="text-blue-500" size={20} aria-hidden="true" />
          <p className="mt-3 text-xs font-semibold text-blue-700">교수님 전달 질문 수</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{professorMemos.length}건</p>
          <p className="mt-1 text-xs text-slate-500">개인 메모는 포함하지 않음</p>
        </article>
        <article className="rounded-2xl bg-emerald-50 p-4 shadow-sm">
          <UsersRound className="text-emerald-500" size={20} aria-hidden="true" />
          <p className="mt-3 text-xs font-semibold text-emerald-700">난이도 응답</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{responseCount}건</p>
          <p className="mt-1 text-xs text-slate-500">주차별 응답 누적</p>
        </article>
        <article className="rounded-2xl bg-violet-50 p-4 shadow-sm">
          <CircleHelp className="text-violet-500" size={20} aria-hidden="true" />
          <p className="mt-3 text-xs font-semibold text-violet-700">분석 과목</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{Math.max(groups.length, 1)}개</p>
          <p className="mt-1 text-xs text-slate-500">담당 과목 기준</p>
        </article>
      </div>

      <div className="mt-5 rounded-3xl bg-gradient-to-br from-slate-50 to-blue-50/70 p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-slate-900">주차별 난이도 분포</p>
            <p className="mt-1 text-xs text-slate-500">{hasRealDifficulty ? "실제 학생 응답" : "예시 데이터 미리보기"}</p>
          </div>
          {!hasRealDifficulty ? <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-blue-600 shadow-sm">DEMO</span> : null}
        </div>
        <div className="mt-4 h-72 w-full" aria-label="주차별 난이도 누적 막대 차트">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartRows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 12 }} />
              <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} unit="%" />
              <Tooltip />
              <Legend iconType="circle" />
              <Bar dataKey="high" name="어려움" stackId="difficulty" fill="#fda4af" radius={[0, 0, 4, 4]} />
              <Bar dataKey="mid" name="보통" stackId="difficulty" fill="#fde68a" />
              <Bar dataKey="low" name="쉬움" stackId="difficulty" fill="#a7f3d0" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {detailOpen ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/40 p-3 backdrop-blur-sm sm:p-6" role="presentation">
          <section
            aria-labelledby="professor-feedback-detail-title"
            aria-modal="true"
            className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-7"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                  {hasRealFeedback ? "LIVE REPORT" : "DEMO REPORT"}
                </span>
                <h3 id="professor-feedback-detail-title" className="mt-3 text-2xl font-bold text-slate-900">학생 학습 체감 상세 리포트</h3>
                <p className="mt-2 text-sm text-slate-500">주차별 난이도 변화와 전달 질문을 함께 살펴보세요.</p>
              </div>
              <button
                aria-label="상세 리포트 닫기"
                className="rounded-full bg-slate-100 p-2 text-slate-600 transition hover:bg-slate-200"
                onClick={() => setDetailOpen(false)}
                type="button"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
              <div className="rounded-2xl bg-slate-50 p-4 sm:p-5">
                <h4 className="font-bold text-slate-900">난이도 응답 추이</h4>
                <div className="mt-4 h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartRows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} axisLine={false} tickLine={false} unit="%" />
                      <Tooltip />
                      <Legend iconType="circle" />
                      <Bar dataKey="high" name="어려움" stackId="difficulty" fill="#fb7185" />
                      <Bar dataKey="mid" name="보통" stackId="difficulty" fill="#facc15" />
                      <Bar dataKey="low" name="쉬움" stackId="difficulty" fill="#34d399" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <aside className="rounded-2xl bg-blue-50/70 p-4 sm:p-5">
                <div className="flex items-center gap-2 text-blue-700">
                  <MessageSquareText size={18} aria-hidden="true" />
                  <h4 className="font-bold">학생 전달 메모</h4>
                </div>
                <div className="mt-4 space-y-3">
                  {professorMemos.length ? professorMemos.map((memo, index) => (
                    <blockquote className="rounded-2xl bg-white p-4 text-sm leading-6 text-slate-700 shadow-sm" key={`${memo}-${index}`}>
                      <span className="mr-2 text-xs font-bold text-blue-500">Q{index + 1}</span>
                      {memo}
                    </blockquote>
                  )) : (
                    <p className="rounded-2xl bg-white p-4 text-sm text-slate-500 shadow-sm">전달된 질문이 아직 없습니다.</p>
                  )}
                </div>
              </aside>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

export function ProfessorCourseProgressReportView({
  report,
  error,
  anonymousAggregateReport,
  anonymousAggregateError,
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

  return (
    <section className="professor-panel" aria-labelledby="professor-course-progress-report-title">
      <div className="community-section-heading">
        <h2 id="professor-course-progress-report-title">과목 진행 현황</h2>
      </div>

      {report.offerings.length === 0 ? (
        <div className="community-empty mt-4">
          <p>확인할 수 있는 과목 진행 데이터가 없습니다.</p>
        </div>
      ) : (
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
                            {student.lastCompletedWeek === null ? "기록 없음" : `${student.lastCompletedWeek}주`}
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
      )}

      <AnonymousAggregateSection
        report={anonymousAggregateReport}
        error={anonymousAggregateError}
      />
    </section>
  );
}
