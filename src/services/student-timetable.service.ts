import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveScheduleSource, type ScheduleSlotInput } from "@/services/student-timetable.rules";

type ScheduleRow = { day_of_week: string; start_time: string; end_time: string; classroom: string | null };
type ProfessorSlotRow = { day_of_week: number; start_time: string; end_time: string; classroom: string | null };

export async function syncStudentCourseSchedule({
  supabase,
  studentCourseId,
  courseId,
  semesterLabel,
  manualSlots,
}: {
  supabase: SupabaseClient;
  studentCourseId: string;
  courseId: string;
  semesterLabel: string;
  manualSlots: ScheduleSlotInput[];
}) {
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
  const resolved = resolveScheduleSource(
    ((syllabusRows ?? []) as ScheduleRow[]).map(toInput),
    professorRows.map(toInput),
    manualSlots,
  );
  if (!resolved.slots.length) throw new Error("수업 시간을 찾을 수 없습니다.");

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
  return resolved;
}
