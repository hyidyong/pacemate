"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { StudentCourseRecord } from "@/services/student-community.service";

const LOCAL_TIMETABLE_ID_PREFIX = "local-timetable-";

// Kept for optimistic regular-course enrollment while the server action saves
// the authoritative student_courses row.
export function createLocalTimetableCourse({
  course, scheduleDay, startTime, endTime, classroom,
}: {
  course: StudentCourseRecord["course"];
  scheduleDay: string;
  startTime: string;
  endTime: string;
  classroom: string;
}): StudentCourseRecord {
  return {
    id: `${LOCAL_TIMETABLE_ID_PREFIX}${course.id}-${Date.now()}`,
    status: "interested", is_favorite: true, schedule_day: scheduleDay,
    start_time: startTime, end_time: endTime, classroom, semester_label: "2026-2", course,
  };
}

export function isLocalTimetableCourse(enrollmentId: string) {
  return enrollmentId.startsWith(LOCAL_TIMETABLE_ID_PREFIX);
}

export type TimetableDisplayItem = {
  id: string;
  parentId: string;
  kind: "course" | "custom";
  course: StudentCourseRecord["course"];
  schedule_day: string;
  start_time: string;
  end_time: string;
  classroom: string | null;
  color: string | null;
};

function normalizedTime(value: string | null | undefined) {
  return value?.slice(0, 5) ?? "";
}

/**
 * Turns the parent records returned by the database into one item per visible
 * timetable block. A legacy row is used only when no normalized slot exists.
 */
export function toTimetableDisplayItems(
  courses: StudentCourseRecord[],
): TimetableDisplayItem[] {
  return courses.flatMap((course) => {
    const slots = course.schedule_slots?.length
      ? course.schedule_slots
      : course.schedule_day && course.start_time && course.end_time
        ? [{
            id: "legacy",
            day_of_week: course.schedule_day,
            start_time: course.start_time,
            end_time: course.end_time,
            classroom: course.classroom,
          }]
        : [];

    return slots.flatMap((slot, index) => {
      const day = slot.day_of_week?.trim();
      const start = normalizedTime(slot.start_time);
      const end = normalizedTime(slot.end_time);
      if (!day || !start || !end || start >= end) return [];

      return [{
        id: `${course.id}:${slot.id || index}`,
        parentId: course.id,
        kind: course.is_custom ? "custom" : "course",
        course: course.course,
        schedule_day: day,
        start_time: start,
        end_time: end,
        classroom: slot.classroom ?? course.classroom,
        color: course.timetable_color ?? null,
      }];
    });
  });
}

export function removeTimetableCourse(courses: StudentCourseRecord[], enrollmentId: string) {
  return courses.filter((item) => item.id !== enrollmentId);
}

export function upsertTimetableCourse(
  courses: StudentCourseRecord[],
  nextCourse: StudentCourseRecord,
) {
  const existingIndex = courses.findIndex((item) => item.id === nextCourse.id);
  if (existingIndex >= 0) {
    return courses.map((item, index) => (index === existingIndex ? nextCourse : item));
  }

  // A regular course is the authoritative student_courses row. Custom courses
  // are identified by their own parent id and may share a title with it.
  if (!nextCourse.is_custom) {
    const sameCourseIndex = courses.findIndex(
      (item) => !item.is_custom && item.course.id === nextCourse.course.id,
    );
    if (sameCourseIndex >= 0) {
      return courses.map((item, index) => (index === sameCourseIndex ? nextCourse : item));
    }
  }

  return [nextCourse, ...courses];
}

export function useStudentTimetable(initialCourses: StudentCourseRecord[]) {
  const initialSnapshot = useMemo(() => initialCourses, [initialCourses]);
  const [courses, setCourses] = useState<StudentCourseRecord[]>(initialSnapshot);

  useEffect(() => {
    setCourses(initialSnapshot);
  }, [initialSnapshot]);

  const replaceCourses = useCallback(
    (next: StudentCourseRecord[] | ((previous: StudentCourseRecord[]) => StudentCourseRecord[])) => {
      setCourses(next);
    },
    [],
  );

  return {
    timetableCourses: courses,
    timetableItems: toTimetableDisplayItems(courses),
    setTimetableCourses: replaceCourses,
  };
}
