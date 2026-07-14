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
