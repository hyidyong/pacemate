import assert from "node:assert/strict";
import test from "node:test";
import { calculateRecommendedAvailability } from "./calendar-utils.ts";

// Week of Mon 2026-08-10 .. Fri 2026-08-14 (KST-like local machine assumption
// matches the production component, which also uses local Date methods).
const weekDates = [1, 2, 3, 4, 5].map((dayIndex, index) => {
  const fullDate = new Date(2026, 7, 10 + index);
  return { label: "", date: fullDate.getDate(), fullDate, dayIndex };
});

const noTeaching = [];
const noAdmin = [];
const noRequests = [];
const noAvailability = [];

function chunksAt(slots, day, start) {
  return slots.filter((slot) => slot.day === day && slot.start === start);
}

test("a pending counseling request blocks its time from being shown as available", () => {
  // Pending request Mon 2026-08-10 10:00-10:30 local time.
  const pending = {
    id: "req-1",
    status: "pending",
    requested_start: new Date(2026, 7, 10, 10, 0).toISOString(),
    requested_end: new Date(2026, 7, 10, 10, 30).toISOString(),
    suggested_start: null,
    suggested_end: null,
  };

  const slots = calculateRecommendedAvailability(
    noTeaching,
    noAdmin,
    [pending],
    noAvailability,
    weekDates,
  );

  // Students cannot book this time (busy filter 'pending','approved' +
  // DB exclusion constraint), so the calendar must not offer it as free.
  const offered = chunksAt(slots, 1, "10:00").filter((slot) => !slot.isBlackout);
  assert.equal(
    offered.length,
    0,
    "Mon 10:00-10:30 with a pending request must not be shown as 상담 가능",
  );
});

test("an inactive availability row blacks out every chunk it covers, not just the first", () => {
  // Professor blacked out Tue 10:00-11:00 (the calendar's blackout toggle
  // writes 1-hour rows); student engine blocks the whole hour by overlap.
  const inactiveHour = {
    id: "avail-1",
    day_of_week: 2,
    specific_date: null,
    start_time: "10:00:00",
    end_time: "11:00:00",
    slot_minutes: 30,
    is_active: false,
  };

  const slots = calculateRecommendedAvailability(
    noTeaching,
    noAdmin,
    noRequests,
    [inactiveHour],
    weekDates,
  );

  const firstHalf = chunksAt(slots, 2, "10:00");
  const secondHalf = chunksAt(slots, 2, "10:30");
  assert.equal(firstHalf.length, 1);
  assert.equal(secondHalf.length, 1);
  assert.equal(firstHalf[0].isBlackout, true, "10:00-10:30 must be 상담 불가");
  assert.equal(
    secondHalf[0].isBlackout,
    true,
    "10:30-11:00 is covered by the same inactive row and must also be 상담 불가",
  );
});
