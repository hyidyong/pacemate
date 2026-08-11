import assert from "node:assert/strict";
import test from "node:test";

import {
  PACEMATE_TIME_ZONE,
  buildAvailableCounselingSlots,
  getCounselingLocalDateKey,
} from "./counseling-slots.ts";

// Characterization suite: freezes the canonical engine's CURRENT semantics before the
// Stage 2 refactor. Every test here must pass with zero production changes.
//
// Base fixture time: 2026-07-12T00:00:00Z = Sunday 2026-07-12 09:00 KST.
// Horizon (+1..+14 KST days): Mon 7/13 .. Sun 7/26.
// Weekday Mondays inside the horizon: 7/13 and 7/20.

const PROFESSOR_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROFESSOR_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function kst(dateKey, time) {
  return new Date(`${dateKey}T${time}:00+09:00`).toISOString();
}

function availabilityRow(overrides = {}) {
  return {
    professorId: PROFESSOR_A,
    professorName: "테스트 교수",
    professorOffice: null,
    professorEmail: null,
    dayOfWeek: 1,
    specificDate: null,
    startTime: "10:00",
    endTime: "12:00",
    slotMinutes: 30,
    isActive: true,
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    now: new Date("2026-07-12T00:00:00.000Z"),
    timeZone: PACEMATE_TIME_ZONE,
    availability: [availabilityRow()],
    teachingSlots: [],
    busyRequests: [],
    adminTasks: [],
    ...overrides,
  };
}

function starts(slots) {
  return slots.map((slot) => slot.start);
}

test("horizon spans exactly now+1 through now+14 in KST days", () => {
  // Wed 2026-07-15 09:00 KST → +1 = Thu 7/16, +14 = Wed 7/29, +15 = Thu 7/30.
  const now = new Date("2026-07-15T00:00:00.000Z");
  const dates = ["2026-07-15", "2026-07-16", "2026-07-29", "2026-07-30"];
  const slots = buildAvailableCounselingSlots(
    baseInput({
      now,
      availability: dates.map((specificDate) =>
        availabilityRow({ specificDate, dayOfWeek: null, endTime: "10:30" }),
      ),
    }),
  );

  assert.deepEqual(starts(slots), [kst("2026-07-16", "10:00"), kst("2026-07-29", "10:00")]);
});

test("weekend availability rows and weekend specific dates yield no slots", () => {
  const slots = buildAvailableCounselingSlots(
    baseInput({
      availability: [
        availabilityRow({ dayOfWeek: 0 }),
        availabilityRow({ dayOfWeek: 6 }),
        // Sat 2026-07-18 is inside the horizon but not a weekday.
        availabilityRow({ dayOfWeek: null, specificDate: "2026-07-18" }),
      ],
    }),
  );

  assert.equal(slots.length, 0);
});

test("a specific-date row fires only on that date and ignores its day_of_week", () => {
  const slots = buildAvailableCounselingSlots(
    baseInput({
      availability: [
        // Tue 2026-07-14 with a deliberately wrong recurring weekday (Monday).
        availabilityRow({ specificDate: "2026-07-14", dayOfWeek: 1, endTime: "10:30" }),
      ],
    }),
  );

  assert.deepEqual(starts(slots), [kst("2026-07-14", "10:00")]);
});

test("a teaching slot removes only its overlap, on every recurring week", () => {
  const slots = buildAvailableCounselingSlots(
    baseInput({
      teachingSlots: [
        { professorId: PROFESSOR_A, dayOfWeek: 1, startTime: "10:00", endTime: "10:30" },
      ],
    }),
  );

  assert.deepEqual(starts(slots), [
    kst("2026-07-13", "10:30"),
    kst("2026-07-13", "11:00"),
    kst("2026-07-13", "11:30"),
    kst("2026-07-20", "10:30"),
    kst("2026-07-20", "11:00"),
    kst("2026-07-20", "11:30"),
  ]);
});

test("a recurring admin task removes only its overlap, on every recurring week", () => {
  const slots = buildAvailableCounselingSlots(
    baseInput({
      adminTasks: [
        {
          professorId: PROFESSOR_A,
          title: "정기 회의",
          dayOfWeek: 1,
          startTime: "11:00",
          endTime: "11:30",
        },
      ],
    }),
  );

  assert.deepEqual(starts(slots), [
    kst("2026-07-13", "10:00"),
    kst("2026-07-13", "10:30"),
    kst("2026-07-13", "11:30"),
    kst("2026-07-20", "10:00"),
    kst("2026-07-20", "10:30"),
    kst("2026-07-20", "11:30"),
  ]);
});

test("an inactive availability row blacks out every chunk it covers, on every week", () => {
  const slots = buildAvailableCounselingSlots(
    baseInput({
      availability: [
        availabilityRow(),
        availabilityRow({ startTime: "10:00", endTime: "11:00", isActive: false }),
      ],
    }),
  );

  assert.deepEqual(starts(slots), [
    kst("2026-07-13", "11:00"),
    kst("2026-07-13", "11:30"),
    kst("2026-07-20", "11:00"),
    kst("2026-07-20", "11:30"),
  ]);
});

test("a busy request blocks only its own date, not the recurring week after", () => {
  const slots = buildAvailableCounselingSlots(
    baseInput({
      busyRequests: [
        {
          professorId: PROFESSOR_A,
          start: kst("2026-07-13", "10:00"),
          end: kst("2026-07-13", "10:30"),
        },
      ],
    }),
  );

  assert.deepEqual(starts(slots), [
    kst("2026-07-13", "10:30"),
    kst("2026-07-13", "11:00"),
    kst("2026-07-13", "11:30"),
    kst("2026-07-20", "10:00"),
    kst("2026-07-20", "10:30"),
    kst("2026-07-20", "11:00"),
    kst("2026-07-20", "11:30"),
  ]);
});

test("a dated __BLACKOUT__ admin task suppresses only that date and ignores its day_of_week", () => {
  const slots = buildAvailableCounselingSlots(
    baseInput({
      adminTasks: [
        {
          professorId: PROFESSOR_A,
          title: "__BLACKOUT__2026-07-13",
          dayOfWeek: 3, // deliberately wrong weekday — must be ignored
          startTime: "10:00",
          endTime: "12:00",
        },
      ],
    }),
  );

  assert.deepEqual(starts(slots), [
    kst("2026-07-20", "10:00"),
    kst("2026-07-20", "10:30"),
    kst("2026-07-20", "11:00"),
    kst("2026-07-20", "11:30"),
  ]);
});

test("a malformed __BLACKOUT__ title falls back to recurring day_of_week matching", () => {
  const slots = buildAvailableCounselingSlots(
    baseInput({
      adminTasks: [
        {
          professorId: PROFESSOR_A,
          title: "__BLACKOUT__not-a-date",
          dayOfWeek: 1,
          startTime: "10:00",
          endTime: "11:00",
        },
      ],
    }),
  );

  assert.deepEqual(starts(slots), [
    kst("2026-07-13", "11:00"),
    kst("2026-07-13", "11:30"),
    kst("2026-07-20", "11:00"),
    kst("2026-07-20", "11:30"),
  ]);
});

test("duplicate availability rows do not change the slot count", () => {
  const input = baseInput();
  input.availability.push(availabilityRow());

  const slots = buildAvailableCounselingSlots(input);

  assert.equal(slots.length, 8); // 4 chunks × Mondays 7/13, 7/20
});

test("one professor's busy sources never remove another professor's slots", () => {
  const slots = buildAvailableCounselingSlots(
    baseInput({
      availability: [
        availabilityRow(),
        availabilityRow({ professorId: PROFESSOR_B, startTime: "10:00", endTime: "11:00", isActive: false }),
      ],
      teachingSlots: [
        { professorId: PROFESSOR_B, dayOfWeek: 1, startTime: "10:00", endTime: "12:00" },
      ],
      adminTasks: [
        {
          professorId: PROFESSOR_B,
          title: "__BLACKOUT__2026-07-13",
          dayOfWeek: 1,
          startTime: "09:00",
          endTime: "18:00",
        },
      ],
      busyRequests: [
        {
          professorId: PROFESSOR_B,
          start: kst("2026-07-13", "10:00"),
          end: kst("2026-07-13", "12:00"),
        },
      ],
    }),
  );

  assert.equal(slots.length, 8);
  assert.equal(slots.every((slot) => slot.professorId === PROFESSOR_A), true);
});

test("results cap at 48 slots, sorted by start then professor id", () => {
  const weekdays = [1, 2, 3, 4, 5];
  const slots = buildAvailableCounselingSlots(
    baseInput({
      availability: [PROFESSOR_A, PROFESSOR_B].flatMap((professorId) =>
        weekdays.map((dayOfWeek) =>
          availabilityRow({ professorId, dayOfWeek, startTime: "09:00", endTime: "18:00" }),
        ),
      ),
    }),
  );

  assert.equal(slots.length, 48);
  for (let i = 1; i < slots.length; i += 1) {
    const ordered =
      slots[i - 1].start < slots[i].start ||
      (slots[i - 1].start === slots[i].start &&
        slots[i - 1].professorId <= slots[i].professorId);
    assert.equal(ordered, true, `slots[${i - 1}] and slots[${i}] out of order`);
  }
  // 18 chunks/professor on Mon 7/13 (36 total), then the earliest 6 chunks × 2 on Tue 7/14.
  const monday = slots.filter((slot) => slot.start.startsWith("2026-07-13"));
  const tuesday = slots.filter((slot) => slot.start.startsWith("2026-07-14"));
  assert.equal(monday.length, 36);
  assert.equal(tuesday.length, 12);
  assert.equal(tuesday[tuesday.length - 1].start, kst("2026-07-14", "11:30"));
});

test("slot_minutes drives chunk size and drops a trailing partial chunk", () => {
  const twoHour = buildAvailableCounselingSlots(
    baseInput({ availability: [availabilityRow({ slotMinutes: 60 })] }),
  );
  assert.deepEqual(
    starts(twoHour).filter((start) => start.startsWith("2026-07-13")),
    [kst("2026-07-13", "10:00"), kst("2026-07-13", "11:00")],
  );

  const ninetyMinutes = buildAvailableCounselingSlots(
    baseInput({
      availability: [availabilityRow({ slotMinutes: 60, endTime: "11:30" })],
    }),
  );
  assert.deepEqual(
    starts(ninetyMinutes).filter((start) => start.startsWith("2026-07-13")),
    [kst("2026-07-13", "10:00")],
  );
});

test("getCounselingLocalDateKey resolves the KST calendar day, not the UTC one", () => {
  // 15:30Z on 7/13 is already 00:30 KST on 7/14.
  assert.equal(getCounselingLocalDateKey("2026-07-13T15:30:00.000Z"), "2026-07-14");
});
