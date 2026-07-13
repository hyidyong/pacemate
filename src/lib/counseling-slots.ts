export const PACEMATE_TIME_ZONE = "Asia/Seoul";
const STUDENT_BOOKING_END_HOUR = 18;

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

type BuildAvailableCounselingSlotsInput = {
  now: Date;
  timeZone: string;
  availability: Availability[];
  teachingSlots: RecurringBusyTime[];
  busyRequests: BusyRequest[];
  adminTasks: AdminTask[];
};

type LocalDate = { year: number; month: number; day: number };

export function getCounselingSlotId(
  slot: Pick<CounselingSlot, "professorId" | "start" | "end">,
) {
  return JSON.stringify([slot.professorId, slot.start, slot.end]);
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
  const activeAvailability = availability.filter((item) => item.isActive);
  const blackouts = availability.filter((item) => !item.isActive);

  for (const item of activeAvailability) {
    for (let offset = 1; offset <= 14; offset += 1) {
      const date = addLocalDays(today, offset);
      const dateKey = formatLocalDate(date);
      const dayOfWeek = getDayOfWeek(date);

      if (dayOfWeek < 1 || dayOfWeek > 5 || !matchesDate(item, dateKey, dayOfWeek)) {
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

          const blackoutDate = getAdminBlackoutDate(busy.title);
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

        const slot: CounselingSlot = {
          professorId: item.professorId,
          professorName: item.professorName,
          professorOffice: item.professorOffice,
          professorEmail: item.professorEmail,
          start: start.toISOString(),
          end: end.toISOString(),
        };
        slots.set(getCounselingSlotId(slot), slot);
      }
    }
  }

  return Array.from(slots.values())
    .sort((a, b) => a.start.localeCompare(b.start) || a.professorId.localeCompare(b.professorId))
    .slice(0, 48);
}

function getLocalDate(date: Date, timeZone: string): LocalDate {
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

function addLocalDays(date: LocalDate, days: number): LocalDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function getDayOfWeek(date: LocalDate) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function formatLocalDate(date: LocalDate) {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function localDateTimeToInstant(date: LocalDate, minutes: number, timeZone: string) {
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

function timeToMinutes(time: string) {
  const [hour = "0", minute = "0"] = time.split(":");
  return Number(hour) * 60 + Number(minute);
}

function overlapsMinutes(start: number, end: number, busyStart: string, busyEnd: string) {
  const otherStart = timeToMinutes(busyStart);
  const otherEnd = timeToMinutes(busyEnd);
  return start < otherEnd && otherStart < end;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

function getAdminBlackoutDate(title: string) {
  const match = /^__BLACKOUT__(\d{4}-\d{2}-\d{2})$/.exec(title);
  return match?.[1] ?? null;
}
