/** A calendar-only date in YYYY-MM-DD form. This is intentionally not a Date. */
export type AcademicDateString = string;

export type AcademicAudience = "all" | "student" | "professor";

export type AcademicEventCategory =
  | "semester"
  | "registration"
  | "class"
  | "exam"
  | "graduation"
  | "holiday"
  | "administration"
  | "religious";

export type AcademicSemester = 1 | 2;

export type AcademicSourceStatus = "draft" | "official";

export interface AcademicEvent {
  id: string;
  title: string;
  startDate: AcademicDateString;
  endDate: AcademicDateString;
  category: AcademicEventCategory;
  audience: AcademicAudience;
  semester: AcademicSemester;
  isOfficial: boolean;
  sourceStatus: AcademicSourceStatus;
}
