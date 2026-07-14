"use client";

import Link from "next/link";
import { Clock, MapPin, Calendar as CalendarIcon } from "lucide-react";
import { useStudentTimetable } from "@/lib/student-timetable";
import type { StudentCourseRecord } from "@/services/student-community.service";

const dayNames = ["일", "월", "화", "수", "목", "금", "토"];

export function TodayTimetableWidget({ myCourses }: { myCourses: StudentCourseRecord[] }) {
  const { timetableCourses } = useStudentTimetable(myCourses);
  const today = dayNames[new Date().getDay()];
  const todayCourses = timetableCourses
    .filter((item) => item.schedule_day === today && item.start_time && item.end_time)
    .sort((a, b) => a.start_time!.localeCompare(b.start_time!));

  return (
    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <CalendarIcon size={18} strokeWidth={2.5} />
          </div>
          <div>
            <h3 className="font-bold text-gray-800 text-[15px]">오늘의 시간표</h3>
            <p className="text-[11px] text-gray-400">{today}요일</p>
          </div>
        </div>
        <Link href="/mypage" className="shrink-0 text-sm font-semibold text-emerald-600 hover:text-emerald-700">
          마이페이지에서 관리
        </Link>
      </div>

      {todayCourses.length === 0 ? (
        <div className="text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-200">
          <p className="text-sm text-gray-500 font-medium">오늘 등록된 수업이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {todayCourses.map((course) => (
            <div key={course.id} className="rounded-2xl border border-gray-100 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-gray-900">{course.course.name}</p>
                  <p className="mt-1 text-xs text-gray-500">{course.classroom ?? "강의실 미정"}</p>
                </div>
                <span className="text-xs font-semibold text-emerald-600">{course.schedule_day}</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-gray-600">
                <span className="inline-flex items-center gap-1">
                  <Clock size={12} />
                  {course.start_time} - {course.end_time}
                </span>
                <span className="inline-flex items-center gap-1">
                  <MapPin size={12} />
                  {course.classroom ?? "강의실 미정"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
