"use client";

import Link from "next/link";
import { AlertCircle, CalendarClock, CheckCircle2, Circle, ClipboardList, GraduationCap } from "lucide-react";
import { useEffect, useState } from "react";

export type StudentTodoItem = {
  id: string;
  title: string;
  description: string;
  type: "assignment" | "exam" | "counseling" | "notice";
  courseName?: string | null;
  metaLabel?: string | null;
  metaValue?: string | null;
  linkHref?: string | null;
  linkLabel?: string | null;
};

const STORAGE_KEY = "pacemate_student_todo_done";

const typeMeta: Record<StudentTodoItem["type"], { label: string; className: string; icon: typeof ClipboardList }> = {
  assignment: {
    label: "과제",
    className: "border-amber-200 bg-amber-50 text-amber-700",
    icon: ClipboardList,
  },
  exam: {
    label: "시험/퀴즈",
    className: "border-violet-200 bg-violet-50 text-violet-700",
    icon: AlertCircle,
  },
  counseling: {
    label: "상담",
    className: "border-sky-200 bg-sky-50 text-sky-700",
    icon: GraduationCap,
  },
  notice: {
    label: "공지",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    icon: CalendarClock,
  },
};

export function StudentTodoCard({ items }: { items: StudentTodoItem[] }) {
  const [doneIds, setDoneIds] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as string[];
        setDoneIds(Array.isArray(parsed) ? parsed : []);
      }
    } catch {
      setDoneIds([]);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(doneIds));
  }, [doneIds]);

  const toggleDone = (id: string) => {
    setDoneIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const completedCount = items.filter((item) => doneIds.includes(item.id)).length;

  return (
    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center">
            <CheckCircle2 size={18} strokeWidth={2.5} />
          </div>
          <div>
            <h3 className="font-bold text-gray-800 text-[15px]">오늘의 To-do</h3>
            <p className="text-[11px] text-gray-400">공지와 상담 데이터로 자동 생성됩니다.</p>
          </div>
        </div>
        <span className="text-[11px] font-semibold text-gray-500">
          {completedCount}/{items.length}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-5 text-center">
          <p className="text-sm font-medium text-gray-600">표시할 To-do 항목이 없습니다.</p>
          <p className="mt-1 text-[11px] text-gray-400">교수 공지나 상담 신청이 생기면 자동으로 보여드립니다.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const done = doneIds.includes(item.id);
            const meta = typeMeta[item.type];
            const Icon = meta.icon;

            return (
              <li
                key={item.id}
                className={`rounded-2xl border p-4 transition-colors ${
                  done ? "border-gray-200 bg-gray-50" : "border-gray-100 bg-white"
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => toggleDone(item.id)}
                    className="mt-0.5 shrink-0 text-gray-400 hover:text-violet-600"
                    aria-label={`${item.title} 완료 상태 변경`}
                  >
                    {done ? <CheckCircle2 size={18} className="text-violet-600" /> : <Circle size={18} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${meta.className}`}>
                        <Icon size={12} />
                        {meta.label}
                      </span>
                      {item.courseName ? (
                        <span className="text-[11px] text-gray-500">{item.courseName}</span>
                      ) : null}
                    </div>

                    <p className={`mt-2 text-sm font-semibold ${done ? "text-gray-500 line-through" : "text-gray-900"}`}>
                      {item.title}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-gray-500">{item.description}</p>

                    {(item.metaLabel || item.metaValue) && (
                      <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-gray-500">
                        {item.metaLabel ? <span>{item.metaLabel}</span> : null}
                        {item.metaValue ? <span className="font-medium text-gray-700">{item.metaValue}</span> : null}
                      </div>
                    )}

                    {item.linkHref ? (
                      <Link
                        href={item.linkHref}
                        className="mt-3 inline-flex items-center text-sm font-semibold text-emerald-600 hover:text-emerald-700"
                      >
                        {item.linkLabel ?? "바로가기"}
                      </Link>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
