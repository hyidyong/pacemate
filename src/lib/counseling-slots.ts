export const PACEMATE_TIME_ZONE = "Asia/Seoul";
export const STUDENT_BOOKING_END_HOUR = 18;

import type { CounselingSlot } from "@/types/counseling";

type Availability = {
  professorId: string;
  professorName: string;
  professorOffice: string | null;
  professorEmail: string | null;
  dayOfWeek: number | null;
  specificDate: string | null;
  startTime: string;
  endTime: string;
  slotMinutes: number;
  isActive: boolean;
};

type RecurringBusyTime = {
  professorId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

type AdminTask = RecurringBusyTime & { title: string };

type BusyRequest = {
  professorId: string;
  start: string;
  end: string;
};

export type CounselingScheduleContext = {
  timeZone: string;
  availability: Availability[];
  teachingSlots: RecurringBusyTime[];
  busyRequests: BusyRequest[];
  adminTasks: AdminTask[];
};

type BuildAvailableCounselingSlotsInput = CounselingScheduleContext & {
  now: Date;
};

export type LocalDate = { year: number; month: number; day: number };

export function getCounselingSlotId(
  slot: Pick<CounselingSlot, "professorId" | "start" | "end">,
) {
  return JSON.stringify([
    slot.professorId,
    normalizeInstantString(slot.start),
    normalizeInstantString(slot.end),
  ]);
}

// Slot instants arrive both as Date#toISOString() output ("...000Z") and as
// PostgREST timestamptz serializations ("...+00:00"); ids must not depend on
// which form produced them.
function normalizeInstantString(value: string) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString();
}

export function resolveSelectedCounselingSlot(
  slots: CounselingSlot[],
  selectedDate: string,
  selectedSlotId: string,
) {
  if (!selectedSlotId) {
    return null;
  }

  return (
    slots.find(
      (slot) =>
        getCounselingLocalDateKey(slot.start) === selectedDate &&
        getCounselingSlotId(slot) === selectedSlotId,
    ) ?? null
  );
}

export function getCounselingLocalDateKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return getLocalDateKey(date, PACEMATE_TIME_ZONE);
}

export function buildAvailableCounselingSlots({
  now,
  timeZone,
  availability,
  teachingSlots,
  busyRequests,
  adminTasks,
}: BuildAvailableCounselingSlotsInput) {
  const slots = new Map<string, CounselingSlot>();
  const today = getLocalDate(now, timeZone);
  const context: CounselingScheduleContext = {
    timeZone,
    availability,
    teachingSlots,
    busyRequests,
    adminTasks,
  };

  for (let offset = 1; offset <= 14; offset += 1) {
    for (const slot of buildBookableSlotsForLocalDate(addLocalDays(today, offset), context)) {
      const id = getCounselingSlotId(slot);
      if (!slots.has(id)) {
        slots.set(id, slot);
      }
    }
  }

  // Display cap applies PER PROFESSOR: a global cap over the merged
  // chronological list let one professor's dense early availability crowd a
  // later professor's real slots out of the list entirely (Stage 4, A-2).
  // Slot membership per professor is unchanged — only list length is bounded.
  const perProfessorCount = new Map<string, number>();

  return Array.from(slots.values())
    .sort((a, b) => a.start.localeCompare(b.start) || a.professorId.localeCompare(b.professorId))
    .filter((slot) => {
      const count = perProfessorCount.get(slot.professorId) ?? 0;
      if (count >= 48) {
        return false;
      }
      perProfessorCount.set(slot.professorId, count + 1);
      return true;
    });
}

// The canonical per-date primitive: every consumer that claims a time is
// student-bookable must derive that claim from this function.
export function buildBookableSlotsForLocalDate(
  date: LocalDate,
  { timeZone, availability, teachingSlots, busyRequests, adminTasks }: CounselingScheduleContext,
): CounselingSlot[] {
  const result: CounselingSlot[] = [];
  const dateKey = formatLocalDate(date);
  const dayOfWeek = getDayOfWeek(date);

  if (dayOfWeek < 1 || dayOfWeek > 5) {
    return result;
  }

  const activeAvailability = availability.filter((item) => item.isActive);
  const blackouts = availability.filter((item) => !item.isActive);

  for (const item of activeAvailability) {
    if (!matchesDate(item, dateKey, dayOfWeek)) {
      continue;
    }

    const availabilityStart = timeToMinutes(item.startTime);
    const availabilityEnd = Math.min(
      timeToMinutes(item.endTime),
      STUDENT_BOOKING_END_HOUR * 60,
    );

    for (
      let startMinutes = availabilityStart;
      startMinutes + item.slotMinutes <= availabilityEnd;
      startMinutes += item.slotMinutes
    ) {
      const endMinutes = startMinutes + item.slotMinutes;
      const start = localDateTimeToInstant(date, startMinutes, timeZone);
      const end = localDateTimeToInstant(date, endMinutes, timeZone);

      const conflictsWithTeaching = teachingSlots.some(
        (busy) =>
          busy.professorId === item.professorId &&
          busy.dayOfWeek === dayOfWeek &&
          overlapsMinutes(startMinutes, endMinutes, busy.startTime, busy.endTime),
      );
      const conflictsWithAdmin = adminTasks.some((busy) => {
        if (busy.professorId !== item.professorId) {
          return false;
        }

        const blackoutDate = parseAdminBlackoutDate(busy.title);
        if (blackoutDate ? blackoutDate !== dateKey : busy.dayOfWeek !== dayOfWeek) {
          return false;
        }

        return overlapsMinutes(startMinutes, endMinutes, busy.startTime, busy.endTime);
      });
      const conflictsWithRequest = busyRequests.some(
        (busy) =>
          busy.professorId === item.professorId &&
          overlaps(start, end, new Date(busy.start), new Date(busy.end)),
      );
      const conflictsWithBlackout = blackouts.some(
        (blackout) =>
          blackout.professorId === item.professorId &&
          matchesDate(blackout, dateKey, dayOfWeek) &&
          overlapsMinutes(startMinutes, endMinutes, blackout.startTime, blackout.endTime),
      );

      if (
        conflictsWithTeaching ||
        conflictsWithAdmin ||
        conflictsWithRequest ||
        conflictsWithBlackout
      ) {
        continue;
      }

      result.push({
        professorId: item.professorId,
        professorName: item.professorName,
        professorOffice: item.professorOffice,
        professorEmail: item.professorEmail,
        start: start.toISOString(),
        end: end.toISOString(),
      });
    }
  }

  return result;
}

export function getLocalDate(date: Date, timeZone: string): LocalDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
  };
}

function getLocalDateKey(date: Date, timeZone: string) {
  return formatLocalDate(getLocalDate(date, timeZone));
}

export function addLocalDays(date: LocalDate, days: number): LocalDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

export function getDayOfWeek(date: LocalDate) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export function formatLocalDate(date: LocalDate) {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export function dateKeyToLocalDate(dateKey: string): LocalDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    return null;
  }

  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function localDateTimeToInstant(date: LocalDate, minutes: number, timeZone: string) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const wallClockAsUtc = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  let instant = wallClockAsUtc;

  // Two passes account for zones whose offset changes near this local time.
  for (let pass = 0; pass < 2; pass += 1) {
    const represented = getZonedDateTimeParts(new Date(instant), timeZone);
    const representedAsUtc = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
    );
    instant += wallClockAsUtc - representedAsUtc;
  }

  return new Date(instant);
}

export function instantToLocalParts(value: string | Date, timeZone: string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = getZonedDateTimeParts(date, timeZone);

  return {
    ...parts,
    dateKey: formatLocalDate(parts),
    minutesOfDay: parts.hour * 60 + parts.minute,
  };
}

function getZonedDateTimeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
}

function matchesDate(item: Availability, dateKey: string, dayOfWeek: number) {
  return item.specificDate ? item.specificDate === dateKey : item.dayOfWeek === dayOfWeek;
}

export function timeToMinutes(time: string) {
  const [hour = "0", minute = "0"] = time.split(":");
  return Number(hour) * 60 + Number(minute);
}

export function minutesToTime(minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function timeRangeEndsByStudentCutoff(startTime: string, endTime: string) {
  return timeToMinutes(endTime) <= STUDENT_BOOKING_END_HOUR * 60;
}

// Parses a KST wall-clock string ("YYYY-MM-DD HH:MM" or "YYYY-MM-DDTHH:MM")
// into the instant it denotes in Asia/Seoul, regardless of the host timezone.
export function parsePacemateWallClock(value: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const date = dateKeyToLocalDate(match[1]);
  if (!date) {
    return null;
  }

  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return localDateTimeToInstant(date, minutes, PACEMATE_TIME_ZONE);
}

function overlapsMinutes(start: number, end: number, busyStart: string, busyEnd: string) {
  const otherStart = timeToMinutes(busyStart);
  const otherEnd = timeToMinutes(busyEnd);
  return start < otherEnd && otherStart < end;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

export function parseAdminBlackoutDate(title: string) {
  const match = /^__BLACKOUT__(\d{4}-\d{2}-\d{2})$/.exec(title);
  return match?.[1] ?? null;
}
