"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CourseRecord, StudentCourseRecord } from "@/services/student-community.service";

const LOCAL_TIMETABLE_ID_PREFIX = "local-timetable-";

export function createLocalTimetableCourse({
  course,
  scheduleDay,
  startTime,
  endTime,
  classroom,
}: {
  course: CourseRecord;
  scheduleDay: string;
  startTime: string;
  endTime: string;
  classroom: string;
}): StudentCourseRecord {
  return {
    id: `${LOCAL_TIMETABLE_ID_PREFIX}${course.id}-${Date.now()}`,
    status: "interested",
    is_favorite: true,
    schedule_day: scheduleDay,
    start_time: startTime,
    end_time: endTime,
    classroom,
    semester_label: "2026-2",
    course,
  };
}

export function isLocalTimetableCourse(enrollmentId: string) {
  return enrollmentId.startsWith(LOCAL_TIMETABLE_ID_PREFIX);
}

export function upsertTimetableCourse(
  courses: StudentCourseRecord[],
  nextCourse: StudentCourseRecord,
) {
  const existingIndex = courses.findIndex((item) => item.id === nextCourse.id);
  if (existingIndex >= 0) {
    return courses.map((item, index) => (index === existingIndex ? nextCourse : item));
  }

  const sameCourseIndex = courses.findIndex((item) => item.course.id === nextCourse.course.id);
  if (sameCourseIndex >= 0) {
    return courses.map((item, index) => (index === sameCourseIndex ? nextCourse : item));
  }

  return [nextCourse, ...courses];
}

export function removeTimetableCourse(courses: StudentCourseRecord[], enrollmentId: string) {
  return courses.filter((item) => item.id !== enrollmentId);
}

export function useStudentTimetable(initialCourses: StudentCourseRecord[]) {
  const initialSnapshot = useMemo(() => initialCourses, [initialCourses]);
  const [courses, setCourses] = useState<StudentCourseRecord[]>(initialSnapshot);

  useEffect(() => {
    setCourses(initialSnapshot);
  }, [initialSnapshot]);

  const replaceCourses = useCallback((nextCourses: StudentCourseRecord[]) => {
    setCourses(nextCourses);
  }, []);

  return { timetableCourses: courses, setTimetableCourses: replaceCourses };
}
