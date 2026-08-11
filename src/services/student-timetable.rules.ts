export type ScheduleSlotInput = {
  dayOfWeek: string | number;
  startTime: string;
  endTime: string;
  classroom?: string | null;
};

export type KoreanWeekday = "일" | "월" | "화" | "수" | "목" | "금" | "토";

export type ScheduleSlot = {
  dayOfWeek: KoreanWeekday;
  startTime: string;
  endTime: string;
  classroom: string | null;
};

export type ScheduleSource = "syllabus" | "professor" | "manual";

const KOREAN_WEEKDAYS: KoreanWeekday[] = ["일", "월", "화", "수", "목", "금", "토"];
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function toKoreanWeekday(dayOfWeek: string | number): KoreanWeekday | null {
  if (typeof dayOfWeek === "number") {
    return Number.isInteger(dayOfWeek) && dayOfWeek >= 0 && dayOfWeek <= 6
      ? KOREAN_WEEKDAYS[dayOfWeek]
      : null;
  }

  const weekday = dayOfWeek.trim();
  return KOREAN_WEEKDAYS.includes(weekday as KoreanWeekday)
    ? (weekday as KoreanWeekday)
    : null;
}

export function validateScheduleSlots(slots: ScheduleSlotInput[]): ScheduleSlot[] {
  const seen = new Set<string>();

  return slots.flatMap((slot) => {
    const dayOfWeek = toKoreanWeekday(slot.dayOfWeek);
    if (
      !dayOfWeek ||
      !TIME_PATTERN.test(slot.startTime) ||
      !TIME_PATTERN.test(slot.endTime) ||
      slot.startTime >= slot.endTime
    ) {
      return [];
    }

    const key = `${dayOfWeek}|${slot.startTime}|${slot.endTime}`;
    if (seen.has(key)) {
      return [];
    }

    seen.add(key);
    return [
      {
        dayOfWeek,
        startTime: slot.startTime,
        endTime: slot.endTime,
        classroom: slot.classroom?.trim() || null,
      },
    ];
  });
}

export function resolveScheduleSource(
  syllabusSlots: ScheduleSlotInput[],
  professorSlots: ScheduleSlotInput[],
  manualSlots: ScheduleSlotInput[],
): { source: ScheduleSource; slots: ScheduleSlot[] } {
  const [source, slots] = syllabusSlots.length
    ? (["syllabus", syllabusSlots] as const)
    : professorSlots.length
      ? (["professor", professorSlots] as const)
      : (["manual", manualSlots] as const);

  return { source, slots: validateScheduleSlots(slots) };
}

// Registration links student_courses.offering_id only when the course has
// exactly one offering in the semester — an ambiguous or missing offering
// must stay null rather than guessing a section.
export function selectOfferingIdForCourse(
  offerings: Array<{ id: string | null }>,
): string | null {
  const ids = offerings
    .map((offering) => offering.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return ids.length === 1 ? ids[0] : null;
}

// A slot already known to belong to some parent (a registered course or a
// custom schedule entry) that a new slot can be checked for overlap against.
export type ExistingScheduleEntry = {
  parentId: string;
  label: string;
  dayOfWeek: KoreanWeekday;
  startTime: string;
  endTime: string;
};

export type ScheduleConflict = {
  newSlot: ScheduleSlot;
  existing: ExistingScheduleEntry;
};

// Half-open interval overlap test on zero-padded "HH:MM" strings, which sort
// lexicographically the same as chronologically, so no minute conversion is
// needed (matches the format validateScheduleSlots already enforces).
export function slotsOverlap(
  a: { dayOfWeek: KoreanWeekday; startTime: string; endTime: string },
  b: { dayOfWeek: KoreanWeekday; startTime: string; endTime: string },
): boolean {
  return a.dayOfWeek === b.dayOfWeek && a.startTime < b.endTime && b.startTime < a.endTime;
}

export function findScheduleConflicts(
  newSlots: ScheduleSlot[],
  existingEntries: ExistingScheduleEntry[],
  excludeParentId?: string,
): ScheduleConflict[] {
  const candidates = excludeParentId
    ? existingEntries.filter((entry) => entry.parentId !== excludeParentId)
    : existingEntries;

  const conflicts: ScheduleConflict[] = [];
  for (const newSlot of newSlots) {
    for (const existing of candidates) {
      if (slotsOverlap(newSlot, existing)) {
        conflicts.push({ newSlot, existing });
      }
    }
  }
  return conflicts;
}
