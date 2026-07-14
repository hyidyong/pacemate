"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CourseRecord, StudentCourseRecord } from "@/services/student-community.service";

export const STUDENT_TIMETABLE_STORAGE_KEY = "pacemate:student-timetable:v1";
export const STUDENT_TIMETABLE_UPDATED_EVENT = "pacemate:student-timetable-updated";
const LOCAL_TIMETABLE_ID_PREFIX = "local-timetable-";

function normalizeTimetableCourses(value: unknown): StudentCourseRecord[] {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is StudentCourseRecord => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Partial<StudentCourseRecord>;
    return (
      typeof candidate.id === "string" &&
      typeof candidate.status === "string" &&
      typeof candidate.is_favorite === "boolean" &&
      Boolean(candidate.course) &&
      typeof candidate.course?.id === "string" &&
      typeof candidate.course?.name === "string"
    );
  });
}

function readStoredTimetableCourses() {
  if (typeof window === "undefined") return null;

  try {
    const stored = window.localStorage.getItem(STUDENT_TIMETABLE_STORAGE_KEY);
    return stored ? normalizeTimetableCourses(JSON.parse(stored)) : null;
  } catch {
    return null;
  }
}

function writeStoredTimetableCourses(courses: StudentCourseRecord[]) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(STUDENT_TIMETABLE_STORAGE_KEY, JSON.stringify(courses));
  window.dispatchEvent(new Event(STUDENT_TIMETABLE_UPDATED_EVENT));
}

function mergeTimetableCourses(
  storedCourses: StudentCourseRecord[],
  initialCourses: StudentCourseRecord[],
) {
  const merged = [...storedCourses];

  for (const initialCourse of initialCourses) {
    const alreadyStored = merged.some((item) => item.id === initialCourse.id);
    const sameCourseStored = merged.some((item) => item.course.id === initialCourse.course.id);

    if (!alreadyStored && !sameCourseStored) {
      merged.push(initialCourse);
    }
  }

  return merged;
}

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
    const storedCourses = readStoredTimetableCourses();
    const nextCourses = storedCourses
      ? mergeTimetableCourses(storedCourses, initialSnapshot)
      : initialSnapshot;

    setCourses(nextCourses);
    if (!storedCourses || nextCourses.length !== storedCourses.length) {
      writeStoredTimetableCourses(nextCourses);
    }
  }, [initialSnapshot]);

  useEffect(() => {
    const syncFromStorage = () => {
      const storedCourses = readStoredTimetableCourses();
      if (storedCourses) {
        setCourses(storedCourses);
      }
    };

    window.addEventListener(STUDENT_TIMETABLE_UPDATED_EVENT, syncFromStorage);
    window.addEventListener("storage", syncFromStorage);

    return () => {
      window.removeEventListener(STUDENT_TIMETABLE_UPDATED_EVENT, syncFromStorage);
      window.removeEventListener("storage", syncFromStorage);
    };
  }, []);

  const replaceCourses = useCallback((nextCourses: StudentCourseRecord[]) => {
    setCourses(nextCourses);
    writeStoredTimetableCourses(nextCourses);
  }, []);

  return { timetableCourses: courses, setTimetableCourses: replaceCourses };
}
