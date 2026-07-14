type SupabaseErrorLike = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
};

/**
 * The timetable-slot migration is newer than the original student_courses
 * columns. Keep existing schedules visible while an environment is still on
 * that older schema instead of treating the missing embedded relation/RPC as
 * an empty timetable.
 */
export function isMissingTimetableSchema(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const { code, message, details } = error as SupabaseErrorLike;
  if (code === "42P01" || code === "PGRST200" || code === "PGRST202") return true;

  const description = [message, details]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return [
    "student_course_schedule_slots",
    "student_custom_course_schedule_slots",
    "replace_student_course_schedule_slots",
    "replace_student_custom_course_schedule_slots",
    "could not find a relationship",
    "schema cache",
  ].some((needle) => description.includes(needle));
}
