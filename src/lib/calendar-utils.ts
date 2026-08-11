import type { CounselingSlot } from "@/types/counseling";
// Relative .ts import (not the @/ alias) so the node:test type-stripping
// runner can execute this module directly; see tsconfig
// allowImportingTsExtensions.
import {
  PACEMATE_TIME_ZONE,
  buildBookableSlotsForLocalDate,
  dateKeyToLocalDate,
  parseAdminBlackoutDate,
  timeToMinutes as domainTimeToMinutes,
  minutesToTime as domainMinutesToTime,
  instantToLocalParts,
  type CounselingScheduleContext,
} from "./counseling-slots.ts";

// ---------------------------------------------------------------------------
// Professor week availability adapter (Stage 2).
// Structural row shapes so the adapter does not depend on service query types.
// ---------------------------------------------------------------------------

type WeekAvailabilityRow = {
  id: string;
  day_of_week: number | null;
  specific_date?: string | null;
  start_time: string;
  end_time: string;
  slot_minutes: number;
  is_active: boolean;
};

type WeekTeachingSlot = {
  day_of_week: number;
  start_time: string;
  end_time: string;
};

type WeekAdminTask = {
  id: string;
  title: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
};

type WeekCounselingRequest = {
  status: string;
  requested_start: string;
  requested_end: string;
  suggested_start?: string | null;
  suggested_end?: string | null;
};

export type ProfessorWeekChunk = {
  day: number; // 1..5, Monday-first column index matching weekDateKeys order
  specificDate: string; // KST date key of the column
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  kind: "bookable" | "blocked" | "free";
  isBlackout: boolean;
  id?: string;
};

export type ProfessorWeekAvailability = {
  bookableSlots: CounselingSlot[];
  chunks: ProfessorWeekChunk[];
};

export type BuildProfessorWeekAvailabilityInput = {
  professorId: string;
  weekDateKeys: string[]; // KST date keys, Monday..Friday
  teachingSlots: WeekTeachingSlot[];
  adminTasks: WeekAdminTask[];
  counselingRequests: WeekCounselingRequest[];
  availability: WeekAvailabilityRow[];
};

const GRID_START_MINUTES = 9 * 60;
const GRID_END_MINUTES = 18 * 60;
const GRID_CHUNK_MINUTES = 30;

export function buildProfessorWeekAvailability({
  professorId,
  weekDateKeys,
  teachingSlots,
  adminTasks,
  counselingRequests,
  availability,
}: BuildProfessorWeekAvailabilityInput): ProfessorWeekAvailability {
  const context: CounselingScheduleContext = {
    timeZone: PACEMATE_TIME_ZONE,
    availability: availability.map((row) => ({
      professorId,
      professorName: "",
      professorOffice: null,
      professorEmail: null,
      dayOfWeek: row.day_of_week,
      specificDate: row.specific_date ?? null,
      startTime: row.start_time,
      endTime: row.end_time,
      slotMinutes: row.slot_minutes,
      isActive: row.is_active,
    })),
    teachingSlots: teachingSlots.map((slot) => ({
      professorId,
      dayOfWeek: slot.day_of_week,
      startTime: slot.start_time,
      endTime: slot.end_time,
    })),
    // Busy time is requested_* only — the DB exclusion constraint and the
    // student engine both hold requested_*; suggested_* is advisory.
    busyRequests: counselingRequests
      .filter((request) => request.status === "approved" || request.status === "pending")
      .map((request) => ({
        professorId,
        start: request.requested_start,
        end: request.requested_end,
      })),
    adminTasks: adminTasks.map((task) => ({
      professorId,
      title: task.title,
      dayOfWeek: task.day_of_week,
      startTime: task.start_time,
      endTime: task.end_time,
    })),
  };

  const bookableSlots: CounselingSlot[] = [];
  const chunks: ProfessorWeekChunk[] = [];

  weekDateKeys.forEach((dateKey, index) => {
    const day = index + 1;
    const localDate = dateKeyToLocalDate(dateKey);
    if (!localDate) {
      return;
    }

    const daySlots = buildBookableSlotsForLocalDate(localDate, context);
    bookableSlots.push(...daySlots);
    const bookableRanges = daySlots.map((slot) => ({
      start: instantToLocalParts(slot.start, PACEMATE_TIME_ZONE).minutesOfDay,
      end: instantToLocalParts(slot.end, PACEMATE_TIME_ZONE).minutesOfDay,
    }));

    const matchesRowDate = (row: WeekAvailabilityRow) =>
      row.specific_date ? row.specific_date === dateKey : row.day_of_week === day;

    const busyRanges: { start: number; end: number }[] = [];

    for (const slot of teachingSlots) {
      if (slot.day_of_week === day) {
        busyRanges.push({
          start: domainTimeToMinutes(slot.start_time.slice(0, 5)),
          end: domainTimeToMinutes(slot.end_time.slice(0, 5)),
        });
      }
    }

    for (const task of adminTasks) {
      const blackoutDate = parseAdminBlackoutDate(task.title);
      const matches = blackoutDate ? blackoutDate === dateKey : task.day_of_week === day;
      if (matches) {
        busyRanges.push({
          start: domainTimeToMinutes(task.start_time.slice(0, 5)),
          end: domainTimeToMinutes(task.end_time.slice(0, 5)),
        });
      }
    }

    for (const request of counselingRequests) {
      if (request.status !== "approved" && request.status !== "pending") {
        continue;
      }

      const startParts = instantToLocalParts(request.requested_start, PACEMATE_TIME_ZONE);
      const endParts = instantToLocalParts(request.requested_end, PACEMATE_TIME_ZONE);
      if (startParts.dateKey === dateKey) {
        busyRanges.push({ start: startParts.minutesOfDay, end: endParts.minutesOfDay });
      }
    }

    for (const range of subtractBusyRanges(busyRanges)) {
      let chunkStart = range.start;
      while (chunkStart + GRID_CHUNK_MINUTES <= range.end) {
        const chunkEnd = chunkStart + GRID_CHUNK_MINUTES;
        const startStr = domainMinutesToTime(chunkStart);

        const existingRecord = availability.find(
          (row) => matchesRowDate(row) && row.start_time.startsWith(startStr),
        );
        const overlappingBlackout = availability.find(
          (row) =>
            matchesRowDate(row) &&
            !row.is_active &&
            chunkStart < domainTimeToMinutes(row.end_time.slice(0, 5)) &&
            domainTimeToMinutes(row.start_time.slice(0, 5)) < chunkEnd,
        );

        const isBlackout = overlappingBlackout
          ? true
          : existingRecord
            ? !existingRecord.is_active
            : false;
        const isBookable =
          !isBlackout &&
          bookableRanges.some(
            (bookable) => chunkStart < bookable.end && bookable.start < chunkEnd,
          );

        chunks.push({
          day,
          specificDate: dateKey,
          start: startStr,
          end: domainMinutesToTime(chunkEnd),
          kind: isBlackout ? "blocked" : isBookable ? "bookable" : "free",
          isBlackout,
          id: existingRecord?.id ?? overlappingBlackout?.id,
        });

        chunkStart += GRID_CHUNK_MINUTES;
      }
    }
  });

  return { bookableSlots, chunks };
}

function subtractBusyRanges(busyRanges: { start: number; end: number }[]) {
  const sorted = [...busyRanges].sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  const free: { start: number; end: number }[] = [];
  let cursor = GRID_START_MINUTES;
  for (const busy of merged) {
    if (busy.start > cursor) {
      free.push({ start: cursor, end: Math.min(busy.start, GRID_END_MINUTES) });
    }
    cursor = Math.max(cursor, busy.end);
  }
  if (cursor < GRID_END_MINUTES) {
    free.push({ start: cursor, end: GRID_END_MINUTES });
  }

  return free;
}
