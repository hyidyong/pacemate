"use client";

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { approveWeeklyPlan } from "@/services/weekly-plan-approval.actions";
import type { WeeklyPlanReview, WeeklyPlanWeek } from "@/types/weekly-roadmap";

type EditableWeek = Pick<WeeklyPlanWeek, "weekNumber" | "title" | "topics" | "activityType" | "isAssessment"> & {
  content: string;
};

const activityLabels: Record<WeeklyPlanWeek["activityType"], string> = {
  lecture: "강의",
  review: "복습",
  discussion: "토론",
  assignment: "과제",
  assessment: "평가",
};

function toEditableWeek(week: WeeklyPlanWeek): EditableWeek {
  return {
    weekNumber: week.weekNumber,
    title: week.title,
    topics: week.topics,
    content: week.topics.join(" · "),
    activityType: week.activityType,
    isAssessment: week.isAssessment,
  };
}

function WeekEditor({
  week,
  isEditing,
  onStart,
  onCancel,
  onSave,
  onChange,
}: {
  week: EditableWeek;
  isEditing: boolean;
  onStart: () => void;
  onCancel: () => void;
  onSave: () => void;
  onChange: (field: "title" | "content", value: string) => void;
}) {
  return (
    <li className="rounded-2xl bg-white p-5 shadow-sm transition-shadow hover:shadow-md sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
            {week.weekNumber}
          </span>
          <div className="min-w-0 flex-1">
            <span className="text-xs font-semibold text-slate-400">{week.weekNumber}주차</span>
            {isEditing ? (
              <input
                aria-label={`${week.weekNumber}주차 제목`}
                className="mt-1 w-full rounded-xl bg-slate-50 px-3 py-2 text-base font-semibold text-slate-900 shadow-inner outline-none transition-shadow focus:shadow-md"
                value={week.title}
                onChange={(event) => onChange("title", event.target.value)}
              />
            ) : (
              <h3 className="mt-1 break-words text-base font-semibold text-slate-900">{week.title}</h3>
            )}
          </div>
        </div>

        {isEditing ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label={`${week.weekNumber}주차 저장`}
              onClick={onSave}
              className="rounded-full bg-blue-600 p-2 text-white transition-shadow hover:shadow-md"
            >
              <Check size={16} />
            </button>
            <button
              type="button"
              aria-label={`${week.weekNumber}주차 취소`}
              onClick={onCancel}
              className="rounded-full bg-slate-100 p-2 text-slate-600 transition-shadow hover:shadow-md"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            aria-label={`${week.weekNumber}주차 수정`}
            onClick={onStart}
            className="shrink-0 rounded-full bg-slate-100 p-2 text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-600"
          >
            <Pencil size={16} />
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 pl-12">
        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">{activityLabels[week.activityType]}</span>
        {week.isAssessment ? <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">평가</span> : null}
      </div>

      <div className="mt-4 pl-0 sm:pl-12">
        {isEditing ? (
          <textarea
            aria-label={`${week.weekNumber}주차 내용`}
            className="min-h-24 w-full resize-y rounded-xl bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-700 shadow-inner outline-none transition-shadow focus:shadow-md"
            value={week.content}
            onChange={(event) => onChange("content", event.target.value)}
          />
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{week.content}</p>
        )}
      </div>
    </li>
  );
}

function DraftReviewCard({ draft }: { draft: WeeklyPlanReview }) {
  const [weeks, setWeeks] = useState(() => draft.weeks.map(toEditableWeek));
  const [editingWeek, setEditingWeek] = useState<number | null>(null);

  function updateWeek(weekNumber: number, field: "title" | "content", value: string) {
    setWeeks((current) => current.map((week) => week.weekNumber === weekNumber ? { ...week, [field]: value } : week));
  }

  function saveWeek(weekNumber: number) {
    setWeeks((current) => current.map((week) => week.weekNumber === weekNumber ? { ...week, topics: [week.content] } : week));
    setEditingWeek(null);
  }

  return (
    <article className="rounded-3xl bg-slate-50 p-5 shadow-sm sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">주간 계획</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">{draft.courseName}</h2>
          <p className="mt-1 text-sm text-slate-500">{draft.semesterLabel} · {draft.professorName} 교수</p>
        </div>
        <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">검토 중</span>
      </div>

      <ol className="mt-7 space-y-4" aria-label={`${draft.courseName} 주차별 계획`}>
        {weeks.map((week) => (
          <WeekEditor
            key={week.weekNumber}
            week={week}
            isEditing={editingWeek === week.weekNumber}
            onStart={() => setEditingWeek(week.weekNumber)}
            onCancel={() => {
              setWeeks(draft.weeks.map(toEditableWeek));
              setEditingWeek(null);
            }}
            onSave={() => saveWeek(week.weekNumber)}
            onChange={(field, value) => updateWeek(week.weekNumber, field, value)}
          />
        ))}
      </ol>

      <form action={approveWeeklyPlan} className="mt-8 flex justify-end">
        <input name="offeringId" type="hidden" value={draft.offeringId} />
        <input name="editedWeeks" type="hidden" value={JSON.stringify(weeks)} readOnly />
        <button
          className="w-full rounded-2xl bg-blue-600 px-5 py-3.5 text-sm font-bold text-white transition-shadow hover:bg-blue-700 hover:shadow-md sm:w-auto"
          type="submit"
        >
          주간 계획 최종 승인
        </button>
      </form>
    </article>
  );
}

export function WeeklyPlanReviewEditor({ drafts }: { drafts: WeeklyPlanReview[] }) {
  return (
    <div data-testid="weekly-plan-review-editor" className="space-y-6">
      <section className="rounded-2xl bg-white p-5 shadow-sm sm:p-6" aria-label="평가 기준 비율 안내">
        <p className="text-sm font-semibold text-slate-900">평가 기준 비율 안내</p>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-600">
          <span>출석 20%</span><span className="text-slate-300">|</span>
          <span>중간고사 30%</span><span className="text-slate-300">|</span>
          <span>기말고사 30%</span><span className="text-slate-300">|</span>
          <span>과제 20%</span>
        </p>
      </section>
      {drafts.map((draft) => <DraftReviewCard key={draft.offeringId} draft={draft} />)}
    </div>
  );
}
