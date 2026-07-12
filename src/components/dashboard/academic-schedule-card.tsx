"use client";

import { CalendarDays } from "lucide-react";
import { useMemo } from "react";
import type { AcademicEvent, AcademicEventCategory } from "@/types/academic-calendar";

const categoryLabels: Record<AcademicEventCategory, string> = {
  semester: "학기",
  registration: "신청",
  class: "수업",
  exam: "시험",
  graduation: "졸업",
  holiday: "휴일",
  administration: "행정",
  religious: "교내 행사",
};

type AcademicScheduleCardProps = {
  academicEvents: AcademicEvent[];
  title?: string;
  description?: string;
  notice?: string;
  limit?: number;
  headingId?: string;
};

type CalendarDateParts = {
  year: number;
  month: number;
  day: number;
};

function getLocalDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function parseCalendarDate(value: string): CalendarDateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function formatCalendarDate(value: string, showYear: boolean) {
  const date = parseCalendarDate(value);
  if (!date) return value;

  return `${showYear ? `${date.year}년 ` : ""}${date.month}월 ${date.day}일`;
}

function formatEventDate(event: AcademicEvent) {
  if (event.startDate === event.endDate) {
    return formatCalendarDate(event.startDate, false);
  }

  const start = parseCalendarDate(event.startDate);
  const end = parseCalendarDate(event.endDate);
  const showYear = start?.year !== end?.year;

  return `${formatCalendarDate(event.startDate, showYear)} ~ ${formatCalendarDate(event.endDate, showYear)}`;
}

function getVisibleEvents(events: AcademicEvent[], today: string, limit: number) {
  const inProgress = events
    .filter((event) => event.startDate <= today && event.endDate >= today)
    .sort((left, right) => left.startDate.localeCompare(right.startDate));
  const upcoming = events
    .filter((event) => event.startDate > today)
    .sort((left, right) => left.startDate.localeCompare(right.startDate));

  return [
    ...inProgress.map((event) => ({ event, status: "진행 중" as const })),
    ...upcoming.map((event) => ({ event, status: "예정" as const })),
  ].slice(0, limit);
}

export function AcademicScheduleCard({
  academicEvents,
  title = "학사일정",
  description = "주요 학사 일정과 신청 기간을 확인하세요.",
  notice = "학교 사정에 따라 일정이 변경될 수 있습니다.",
  limit = 5,
  headingId = "academic-schedule-title",
}: AcademicScheduleCardProps) {
  const today = getLocalDateKey(new Date());
  const visibleEvents = useMemo(
    () => getVisibleEvents(academicEvents, today, limit),
    [academicEvents, limit, today],
  );

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
    >
      <div className="mb-4 flex items-start gap-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
          <CalendarDays size={18} strokeWidth={2.5} />
        </div>
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-gray-800" id={headingId}>
            {title}
          </h2>
          <p className="mt-1 text-xs text-gray-500">{description}</p>
          <p className="mt-1 text-[11px] text-gray-400">{notice}</p>
        </div>
      </div>

      {visibleEvents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 py-8 text-center">
          <p className="text-sm font-medium text-gray-500">예정된 학사일정이 없습니다.</p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {visibleEvents.map(({ event, status }) => (
            <li className="rounded-xl border border-gray-100 bg-gray-50/70 p-3" key={event.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-gray-900">{event.title}</p>
                  <p className="mt-1 text-xs text-gray-500">{formatEventDate(event)}</p>
                </div>
                <span
                  className={
                    status === "진행 중"
                      ? "shrink-0 rounded-md bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700"
                      : "shrink-0 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600"
                  }
                >
                  {status}
                </span>
              </div>
              <span className="mt-2 inline-flex rounded-md bg-white px-2 py-1 text-[11px] font-medium text-gray-600 ring-1 ring-gray-200">
                {categoryLabels[event.category]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
