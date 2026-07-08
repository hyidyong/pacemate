"use client";

import Link from "next/link";
import { ClipboardCheck, MessageSquareText } from "lucide-react";

type ProfessorAdminSummaryProps = {
  counselingCount: number;
  questionCount: number;
};

export function ProfessorAdminSummary({ counselingCount, questionCount }: ProfessorAdminSummaryProps) {
  return (
    <div className="professor-admin-summary grid gap-3 sm:grid-cols-2 mt-4">
      <Link
        href="/professor?tab=counseling&sub=pending-counseling"
        className="group block rounded-3xl border border-slate-200 bg-white px-4 py-4 transition hover:-translate-y-0.5 hover:shadow-lg"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">상담 신청 승인</p>
            <h3 className="mt-2 text-lg font-semibold text-slate-900">{counselingCount}건</h3>
          </div>
          <ClipboardCheck className="h-6 w-6 text-emerald-600" aria-hidden="true" />
        </div>
      </Link>

      <Link
        href="/professor?tab=questions&sub=incoming-questions"
        className="group block rounded-3xl border border-slate-200 bg-white px-4 py-4 transition hover:-translate-y-0.5 hover:shadow-lg"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">질문 요청</p>
            <h3 className="mt-2 text-lg font-semibold text-slate-900">{questionCount}건</h3>
          </div>
          <MessageSquareText className="h-6 w-6 text-sky-600" aria-hidden="true" />
        </div>
      </Link>
    </div>
  );
}
