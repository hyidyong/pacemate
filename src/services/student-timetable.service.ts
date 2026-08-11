import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveScheduleSource,
  toKoreanWeekday,
  type ExistingScheduleEntry,
  type ScheduleSlot,
  type ScheduleSlotInput,
  type ScheduleSource,
} from "@/services/student-timetable.rules";

type ScheduleRow = { day_of_week: string; start_time: string; end_time: string; classroom: string | null };
type ProfessorSlotRow = { day_of_week: number; start_time: string; end_time: string; classroom: string | null };

export async function resolveStudentCourseSchedule({
  supabase,
  courseId,
  semesterLabel,
  manualSlots,
}: {
  supabase: SupabaseClient;
  courseId: string;
  semesterLabel: string;
  manualSlots: ScheduleSlotInput[];
}): Promise<{ source: ScheduleSource; slots: ScheduleSlot[] }> {
  const { data: syllabusRows, error: syllabusError } = await supabase
    .from("course_schedules")
    .select("day_of_week,start_time,end_time,classroom")
    .eq("course_id", courseId);
  if (syllabusError) throw new Error(syllabusError.message);

  let professorRows: ProfessorSlotRow[] = [];
  if (!(syllabusRows ?? []).length) {
    const { data, error } = await supabase
      .from("professor_teaching_slots")
      .select("day_of_week,start_time,end_time,classroom")
      .eq("course_id", courseId)
      .eq("semester_label", semesterLabel);
    if (error) throw new Error(error.message);
    professorRows = (data ?? []) as ProfessorSlotRow[];
  }

  const toInput = (row: ScheduleRow | ProfessorSlotRow): ScheduleSlotInput => ({
    dayOfWeek: row.day_of_week,
    startTime: row.start_time.slice(0, 5),
    endTime: row.end_time.slice(0, 5),
    classroom: row.classroom,
  });

  return resolveScheduleSource(
    ((syllabusRows ?? []) as ScheduleRow[]).map(toInput),
    professorRows.map(toInput),
    manualSlots,
  );
}

export async function writeStudentCourseScheduleSlots({
  supabase,
  studentCourseId,
  resolved,
}: {
  supabase: SupabaseClient;
  studentCourseId: string;
  resolved: { source: ScheduleSource; slots: ScheduleSlot[] };
}) {
  const { error } = await supabase.rpc("replace_student_course_schedule_slots", {
    p_student_course_id: studentCourseId,
    p_slots: resolved.slots.map((slot) => ({
      day_of_week: slot.dayOfWeek,
      start_time: slot.startTime,
      end_time: slot.endTime,
      classroom: slot.classroom,
      source: resolved.source,
    })),
  });
  if (error) throw new Error(error.message);
}

type StudentCourseSlotRow = {
  student_course_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  student_courses: { id: string; course: { name: string } | { name: string }[] | null } | null;
};

type StudentCustomCourseSlotRow = {
  student_custom_course_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  student_custom_courses: { id: string; title: string } | null;
};

// The other slots a student already has, used to warn about time conflicts
// before writing a new course's slots. `excludeParentId` lets callers omit
// the very row being edited (a student_courses.id or a
// student_custom_courses.id — whichever parent owns the slots in progress),
// so re-saving something at its own existing time isn't flagged as a
// conflict with itself.
export async function getExistingScheduleEntries({
  supabase,
  studentId,
  excludeParentId,
}: {
  supabase: SupabaseClient;
  studentId: string;
  excludeParentId?: string;
}): Promise<ExistingScheduleEntry[]> {
  const [courseSlotsResult, customSlotsResult] = await Promise.all([
    supabase
      .from("student_course_schedule_slots")
      .select(
        "student_course_id,day_of_week,start_time,end_time,student_courses!inner(id,student_id,course:courses(name))",
      )
      .eq("student_courses.student_id", studentId),
    supabase
      .from("student_custom_course_schedule_slots")
      .select(
        "student_custom_course_id,day_of_week,start_time,end_time,student_custom_courses!inner(id,student_id,title)",
      )
      .eq("student_custom_courses.student_id", studentId),
  ]);

  if (courseSlotsResult.error) throw new Error(courseSlotsResult.error.message);
  if (customSlotsResult.error) throw new Error(customSlotsResult.error.message);

  const courseEntries = ((courseSlotsResult.data ?? []) as unknown as StudentCourseSlotRow[])
    .filter((row) => row.student_course_id !== excludeParentId)
    .flatMap((row): ExistingScheduleEntry[] => {
      const dayOfWeek = toKoreanWeekday(row.day_of_week);
      const courseRelation = row.student_courses?.course;
      const courseName = Array.isArray(courseRelation) ? courseRelation[0]?.name : courseRelation?.name;
      if (!dayOfWeek) return [];
      return [
        {
          parentId: row.student_course_id,
          label: courseName ?? "과목",
          dayOfWeek,
          startTime: row.start_time.slice(0, 5),
          endTime: row.end_time.slice(0, 5),
        },
      ];
    });

  const customEntries = ((customSlotsResult.data ?? []) as unknown as StudentCustomCourseSlotRow[])
    .filter((row) => row.student_custom_course_id !== excludeParentId)
    .flatMap((row): ExistingScheduleEntry[] => {
      const dayOfWeek = toKoreanWeekday(row.day_of_week);
      if (!dayOfWeek) return [];
      return [
        {
          parentId: row.student_custom_course_id,
          label: row.student_custom_courses?.title ?? "직접 입력 일정",
          dayOfWeek,
          startTime: row.start_time.slice(0, 5),
          endTime: row.end_time.slice(0, 5),
        },
      ];
    },
  );

  return [...courseEntries, ...customEntries];
}
