import type { ScheduleConflict, ScheduleSource } from "@/services/student-timetable.rules";

export type ScheduleConflictInfo = {
  source: ScheduleSource;
  items: ScheduleConflict[];
};

export function ScheduleConflictList({ conflict }: { conflict: ScheduleConflictInfo }) {
  // Multiple new slots can each hit multiple existing courses; de-duplicate
  // by which existing course/slot is being warned about so the same row
  // doesn't repeat once per overlapping new slot.
  const seen = new Set<string>();
  const rows = conflict.items.filter((item) => {
    const key = `${item.existing.parentId}|${item.existing.dayOfWeek}|${item.existing.startTime}|${item.existing.endTime}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <ul className="space-y-2 text-sm">
      {rows.map((item) => (
        <li
          key={`${item.existing.parentId}-${item.existing.dayOfWeek}-${item.existing.startTime}`}
          className="rounded-lg bg-red-50 px-3 py-2 text-red-700"
        >
          <strong>{item.existing.label}</strong> · {item.existing.dayOfWeek}요일{" "}
          {item.existing.startTime}-{item.existing.endTime}
        </li>
      ))}
    </ul>
  );
}
