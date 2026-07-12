"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleDashed, Loader2, LockKeyhole } from "lucide-react";
import { updateStudentWeeklyProgress } from "@/services/student-weekly-progress.actions";
import type {
  StudentWeeklyProgressPreview,
  StudentWeeklyProgressStatus,
} from "@/types/student-weekly-progress";

const statusOptions: Array<{ value: StudentWeeklyProgressStatus; label: string }> = [
  { value: "not_started", label: "시작 전" },
  { value: "in_progress", label: "진행 중" },
  { value: "covered", label: "학습 완료" },
  { value: "needs_review", label: "복습 필요" },
  { value: "skipped", label: "이번 주 제외" },
];

function LevelOptions() {
  return (
    <>
      <option value="">선택</option>
      {[1, 2, 3, 4, 5].map((level) => (
        <option key={level} value={level}>
          {level} / 5
        </option>
      ))}
    </>
  );
}

export function StudentWeeklyProgressPreview({
  preview,
}: {
  preview: StudentWeeklyProgressPreview;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function submitProgress(form: HTMLFormElement) {
    setMessage(null);
    const formData = new FormData(form);
    startTransition(async () => {
      const result = await updateStudentWeeklyProgress(formData);
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  }

  return (
    <section className="section" aria-labelledby="student-weekly-progress-title">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="status-line">{preview.semesterLabel} · 승인된 주간 계획</p>
          <h2 id="student-weekly-progress-title" className="mt-1 text-2xl font-bold text-slate-950">
            {preview.courseName} 학습 진행
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            주차별 학습 상태와 개인 메모를 기록합니다. 이 정보는 공식 졸업 판정이나 학기 리포트가 아닙니다.
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <strong>{preview.summary.coveredCount}</strong> / {preview.summary.totalWeekCount}주 학습 완료
          <span className="ml-2 text-xs">({preview.summary.status})</span>
        </div>
      </div>

      <div className="mb-5 flex items-start gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600">
        <LockKeyhole size={16} className="mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />
        <span>개인 메모는 학생 본인에게만 보입니다. 교수에게 공유할 내용은 별도 입력란에 작성하고 선택적으로 공유하세요.</span>
      </div>

      {message ? (
        <p className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
          {message}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {preview.weeks.map((week) => (
          <form
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            key={week.weekNumber}
            onSubmit={(event) => {
              event.preventDefault();
              submitProgress(event.currentTarget);
            }}
          >
            <input name="offeringId" type="hidden" value={preview.offeringId} />
            <input name="weekNumber" type="hidden" value={week.weekNumber} />
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-start gap-3">
                {week.progressStatus === "covered" ? (
                  <CheckCircle2 className="mt-0.5 text-emerald-600" size={20} aria-hidden="true" />
                ) : (
                  <CircleDashed className="mt-0.5 text-slate-400" size={20} aria-hidden="true" />
                )}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Week {week.weekNumber}</p>
                  <h3 className="mt-1 font-semibold text-slate-900">{week.title ?? "주차 주제 확인 중"}</h3>
                  <p className="mt-1 text-sm text-slate-600">{week.topic ?? "주제 정보 확인 중"}</p>
                </div>
              </div>
              <select
                aria-label={`${week.weekNumber}주 진행 상태`}
                className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs"
                defaultValue={week.progressStatus}
                name="progressStatus"
              >
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-xs text-slate-600">
                난이도
                <select className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm" defaultValue={week.difficultyLevel ?? ""} name="difficultyLevel">
                  <LevelOptions />
                </select>
              </label>
              <label className="text-xs text-slate-600">
                이해도
                <select className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm" defaultValue={week.understandingLevel ?? ""} name="understandingLevel">
                  <LevelOptions />
                </select>
              </label>
            </div>

            <label className="mt-3 block text-xs text-slate-600">
              개인 메모 <span className="text-slate-400">(교수 비공개)</span>
              <textarea className="mt-1 min-h-20 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" defaultValue={week.privateNote ?? ""} name="privateNote" placeholder="나만 볼 복습 메모" />
            </label>
            <label className="mt-3 block text-xs text-slate-600">
              교수 공유 피드백
              <textarea className="mt-1 min-h-20 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" defaultValue={week.sharedFeedback ?? ""} name="sharedFeedback" placeholder="교수에게 공유할 질문이나 피드백" />
            </label>
            <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
              <input name="shareFeedbackWithProfessor" type="checkbox" value="true" defaultChecked={week.shareFeedbackWithProfessor} />
              이 피드백을 교수에게 공유합니다.
            </label>
            <button className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60" disabled={isPending} type="submit">
              {isPending ? <Loader2 className="animate-spin" size={14} aria-hidden="true" /> : null}
              {isPending ? "저장 중" : "주차 진행 저장"}
            </button>
          </form>
        ))}
      </div>
    </section>
  );
}
