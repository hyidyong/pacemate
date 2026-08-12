"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
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

function ApproveSubmitButton({ approved, confirming }: { approved: boolean; confirming: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      className="w-full rounded-2xl bg-blue-600 px-5 py-3.5 text-sm font-bold text-white transition-shadow hover:bg-blue-700 hover:shadow-md disabled:cursor-not-allowed disabled:bg-emerald-200 sm:w-auto"
      disabled={approved || pending}
      type="submit"
    >
      {approved
        ? "승인 완료"
        : pending
          ? "승인 처리 중…"
          : confirming
            ? "한 번 더 누르면 학생에게 공개됩니다"
            : "주간 계획 최종 승인"}
    </button>
  );
}

function DraftReviewCard({ draft }: { draft: WeeklyPlanReview }) {
  const [weeks, setWeeks] = useState(() => draft.weeks.map(toEditableWeek));
  const [editingWeek, setEditingWeek] = useState<number | null>(null);
  const [confirmingApproval, setConfirmingApproval] = useState(false);
  const originalWeeks = draft.weeks.map(toEditableWeek);
  const editedWeekNumbers = weeks
    .filter((week) => {
      const original = originalWeeks.find((item) => item.weekNumber === week.weekNumber);
      return original && (original.title !== week.title || original.content !== week.content);
    })
    .map((week) => week.weekNumber);

  function updateWeek(weekNumber: number, field: "title" | "content", value: string) {
    setWeeks((current) => current.map((week) => week.weekNumber === weekNumber ? { ...week, [field]: value } : week));
  }

  function saveWeek(weekNumber: number) {
    setWeeks((current) => current.map((week) => week.weekNumber === weekNumber ? { ...week, topics: [week.content] } : week));
    setEditingWeek(null);
  }

  // Cancel restores ONLY the week being edited — resetting the whole array
  // silently destroyed every other week's edits (Stage 4, audit B-35).
  function cancelWeek(weekNumber: number) {
    const original = originalWeeks.find((item) => item.weekNumber === weekNumber);
    if (original) {
      setWeeks((current) => current.map((week) => (week.weekNumber === weekNumber ? original : week)));
    }
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
        {draft.approvalStatus === "approved" ? (
          <span className="rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-800">승인 완료</span>
        ) : (
          <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">검토 중</span>
        )}
      </div>

      <ol className="mt-7 space-y-4" aria-label={`${draft.courseName} 주차별 계획`}>
        {weeks.map((week) => (
          <WeekEditor
            key={week.weekNumber}
            week={week}
            isEditing={editingWeek === week.weekNumber}
            onStart={() => setEditingWeek(week.weekNumber)}
            onCancel={() => cancelWeek(week.weekNumber)}
            onSave={() => saveWeek(week.weekNumber)}
            onChange={(field, value) => updateWeek(week.weekNumber, field, value)}
          />
        ))}
      </ol>

      <form
        action={approveWeeklyPlan}
        className="mt-8 flex flex-wrap items-center justify-end gap-3"
        onSubmit={(event) => {
          // Publishing 1~15주차 to students is irreversible from here — the
          // first click arms, the second submits (Stage 4, audit B-36).
          if (!confirmingApproval) {
            event.preventDefault();
            setConfirmingApproval(true);
          }
        }}
      >
        {editedWeekNumbers.length ? (
          <p className="text-xs font-semibold text-amber-700">
            수정된 주차: {editedWeekNumbers.join(", ")}주차 — 승인 시 함께 반영됩니다.
          </p>
        ) : null}
        <input name="offeringId" type="hidden" value={draft.offeringId} />
        <input name="courseId" type="hidden" value={draft.courseId} />
        <input name="editedWeeks" type="hidden" value={JSON.stringify(weeks)} readOnly />
        <ApproveSubmitButton approved={draft.approvalStatus === "approved"} confirming={confirmingApproval} />
      </form>
    </article>
  );
}

export function WeeklyPlanReviewEditor({
  drafts,
  approvalState,
}: {
  drafts: WeeklyPlanReview[];
  approvalState?: "approved" | "already-approved" | "error";
}) {
  return (
    <div data-testid="weekly-plan-review-editor" className="space-y-6">
      {approvalState === "approved" ? <p role="status" className="rounded-2xl bg-emerald-50 px-5 py-4 text-sm font-semibold text-emerald-800">주간 계획을 승인하고 수강 학생에게 업데이트 알림을 보냈습니다.</p> : null}
      {approvalState === "already-approved" ? <p role="status" className="rounded-2xl bg-emerald-50 px-5 py-4 text-sm font-semibold text-emerald-800">이미 승인된 주간 계획입니다.</p> : null}
      {approvalState === "error" ? <p role="alert" className="rounded-2xl bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-800">주간 계획을 승인하지 못했습니다. 다시 시도해 주세요.</p> : null}
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
