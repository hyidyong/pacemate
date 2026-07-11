import { academicCalendar2026 } from "@/data/academic-calendar-2026";
import type {
  AcademicAudience,
  AcademicDateString,
  AcademicEvent,
} from "@/types/academic-calendar";

function sortByStartDate(events: readonly AcademicEvent[]): AcademicEvent[] {
  return [...events].sort(
    (left, right) =>
      left.startDate.localeCompare(right.startDate) ||
      left.endDate.localeCompare(right.endDate) ||
      left.id.localeCompare(right.id)
  );
}

/** Returns all source events in chronological order. */
export function getAcademicEvents(): AcademicEvent[] {
  return sortByStartDate(academicCalendar2026);
}

export function getAcademicEventsByAudience(
  audience: AcademicAudience
): AcademicEvent[] {
  return sortByStartDate(
    academicCalendar2026.filter((event) => event.audience === audience)
  );
}

function getDaysInMonth(year: number, month: number): number {
  if (month === 2) {
    const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return isLeapYear ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * `month` is one-based (1-12). Includes any event that overlaps the requested
 * month. Calendar dates are compared as strings so UTC conversion cannot shift
 * an event into a neighboring day.
 */
export function getAcademicEventsByMonth(
  year: number,
  month: number
): AcademicEvent[] {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return [];
  }

  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(
    getDaysInMonth(year, month)
  ).padStart(2, "0")}`;

  return sortByStartDate(
    academicCalendar2026.filter(
      (event) => event.startDate <= monthEnd && event.endDate >= monthStart
    )
  );
}

/**
 * Includes events in progress on `fromDate`, excludes events already ended,
 * and orders the result by start date without constructing UTC Date objects.
 */
export function getUpcomingAcademicEvents(
  fromDate: AcademicDateString,
  limit: number
): AcademicEvent[] {
  const normalizedLimit = Math.max(0, Math.floor(limit));

  return sortByStartDate(
    academicCalendar2026.filter((event) => event.endDate >= fromDate)
  ).slice(0, normalizedLimit);
}
