import type {
  ProfessorTeachingSlot,
  ProfessorCounselingRequest,
  ProfessorAdminTaskRecord,
  ProfessorAvailability,
} from "@/services/professor.service";
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

// Define a time range type
export type TimeRange = {
  start: string;
  end: string;
};

// Convert HH:MM to minutes
function timeToMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// Convert minutes to HH:MM
function minutesToTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

export function calculateRecommendedAvailability(
  teachingSlots: ProfessorTeachingSlot[],
  adminTasks: ProfessorAdminTaskRecord[],
  counselingRequests: ProfessorCounselingRequest[],
  existingAvailability: ProfessorAvailability[],
  weekDates: { label: string; date: number; fullDate: Date; dayIndex: number }[]
) {
  const days = [1, 2, 3, 4, 5]; // Mon to Fri
  const defaultStart = 9 * 60; // 09:00
  const defaultEnd = 18 * 60; // 18:00
  const recommendedSlots: { day: number; specificDate: string; start: string; end: string; isBlackout: boolean; id?: string; rawSlot?: any }[] = [];

  days.forEach((day, index) => {
    // Collect all busy ranges for this day
    const busyRanges: { start: number; end: number }[] = [];
    const specificDateObj = weekDates[index]?.fullDate;
    const specificDateStr = specificDateObj 
      ? `${specificDateObj.getFullYear()}-${String(specificDateObj.getMonth() + 1).padStart(2, '0')}-${String(specificDateObj.getDate()).padStart(2, '0')}` 
      : null;

    // 1. Courses
    teachingSlots.forEach((slot) => {
      if (slot.day_of_week === day) {
        busyRanges.push({
          start: timeToMinutes(slot.start_time.slice(0, 5)),
          end: timeToMinutes(slot.end_time.slice(0, 5)),
        });
      }
    });

    // 2. Admin Tasks (including specific date blackouts)
    adminTasks.forEach((task) => {
      let isMatch = false;
      if (task.title.startsWith("__BLACKOUT__")) {
         const blackoutDate = task.title.split("__")[2];
         if (specificDateStr === blackoutDate) isMatch = true;
      } else {
         if (task.day_of_week === day) isMatch = true;
      }
      
      if (isMatch) {
        busyRanges.push({
          start: timeToMinutes(task.start_time.slice(0, 5)),
          end: timeToMinutes(task.end_time.slice(0, 5)),
        });
      }
    });

    // 3. Busy counseling requests — pending AND approved both block student
    // booking (DB exclusion constraint), so both must occupy the calendar.
    counselingRequests.forEach((req) => {
      if (req.status === "approved" || req.status === "pending") {
        const start = new Date(req.suggested_start || req.requested_start);
        const end = new Date(req.suggested_end || req.requested_end);
        const startLocalStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
        
        if (start.getDay() === day && startLocalStr === specificDateStr) {
          busyRanges.push({
            start: start.getHours() * 60 + start.getMinutes(),
            end: end.getHours() * 60 + end.getMinutes(),
          });
        }
      }
    });

    // Merge busy ranges
    busyRanges.sort((a, b) => a.start - b.start);
    const mergedBusy: { start: number; end: number }[] = [];
    if (busyRanges.length > 0) {
      let current = busyRanges[0];
      for (let i = 1; i < busyRanges.length; i++) {
        if (busyRanges[i].start <= current.end) {
          current.end = Math.max(current.end, busyRanges[i].end);
        } else {
          mergedBusy.push(current);
          current = busyRanges[i];
        }
      }
      mergedBusy.push(current);
    }

    // Find free ranges
    let lastEnd = defaultStart;
    const freeRanges: { start: number; end: number }[] = [];
    
    mergedBusy.forEach((busy) => {
      if (busy.start > lastEnd) {
        freeRanges.push({ start: lastEnd, end: busy.start });
      }
      lastEnd = Math.max(lastEnd, busy.end);
    });

    if (lastEnd < defaultEnd) {
      freeRanges.push({ start: lastEnd, end: defaultEnd });
    }

    // Now for each free range, divide into 30-min chunks (or 60 min)
    // To match the blackout logic, we will check if existingAvailability marks it as inactive
    freeRanges.forEach((range) => {
      let currentChunkStart = range.start;
      while (currentChunkStart + 30 <= range.end) {
        const chunkEnd = currentChunkStart + 30;
        
        // Check if there's an existing availability record matching this chunk
        const startStr = minutesToTime(currentChunkStart);
        const endStr = minutesToTime(chunkEnd);
        
        const existingRecord = existingAvailability.find(
          (a) => a.day_of_week === day && a.start_time.startsWith(startStr)
        );

        // A blackout (is_active=false) row can span multiple chunks (the
        // calendar's own toggle writes 1-hour rows), so match by overlap —
        // the student engine blocks the entire covered range the same way.
        const overlappingBlackout = existingAvailability.find(
          (a) =>
            a.day_of_week === day &&
            !a.is_active &&
            currentChunkStart < timeToMinutes(a.end_time.slice(0, 5)) &&
            timeToMinutes(a.start_time.slice(0, 5)) < chunkEnd
        );

        // If no record exists, it is "recommended" (active by default)
        // If a record exists and is_active is false, it's a blackout.
        // If a record exists and is_active is true, it's explicitly active.
        const isBlackout = overlappingBlackout
          ? true
          : existingRecord
            ? !existingRecord.is_active
            : false;

        recommendedSlots.push({
          day,
          specificDate: specificDateStr as string,
          start: startStr,
          end: endStr,
          isBlackout,
          id: existingRecord?.id ?? overlappingBlackout?.id,
        });

        currentChunkStart += 30;
      }
    });
  });

  return recommendedSlots;
}
