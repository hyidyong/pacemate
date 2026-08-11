import assert from "node:assert/strict";
import test from "node:test";

import { buildProfessorWeekAvailability } from "./calendar-utils.ts";

// Contract tests for the canonical professor week adapter (Stage 2).
// Week under test: Mon 2026-07-13 .. Fri 2026-07-17 (KST date keys).

const PROFESSOR_ID = "11111111-1111-1111-1111-111111111111";
const WEEK = ["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17"];

function kst(dateKey, time) {
  return new Date(`${dateKey}T${time}:00+09:00`).toISOString();
}

function weekInput(overrides = {}) {
  return {
    professorId: PROFESSOR_ID,
    weekDateKeys: WEEK,
    teachingSlots: [],
    adminTasks: [],
    counselingRequests: [],
    availability: [],
    ...overrides,
  };
}

function activeWindow(overrides = {}) {
  return {
    id: "row-1",
    day_of_week: 1,
    specific_date: null,
    start_time: "10:00:00",
    end_time: "12:00:00",
    slot_minutes: 30,
    is_active: true,
    ...overrides,
  };
}

function chunksAt(chunks, day, start) {
  return chunks.filter((chunk) => chunk.day === day && chunk.start === start);
}

test("zero declared availability rows yield zero student-bookable chunks", () => {
  const { bookableSlots, chunks } = buildProfessorWeekAvailability(weekInput());

  // A professor with no declared windows offers nothing students can book;
  // the whole free grid must classify as undeclared free time, never bookable.
  assert.equal(bookableSlots.length, 0);
  assert.equal(chunks.filter((chunk) => chunk.kind === "bookable").length, 0);
  assert.equal(chunks.length > 0, true);
  assert.equal(chunks.every((chunk) => chunk.kind === "free"), true);
});

test("a declared active window makes exactly its chunks bookable, matching canonical slots", () => {
  const { bookableSlots, chunks } = buildProfessorWeekAvailability(
    weekInput({ availability: [activeWindow()] }),
  );

  assert.deepEqual(
    bookableSlots.map((slot) => [slot.professorId, slot.start, slot.end]),
    [
      [PROFESSOR_ID, kst("2026-07-13", "10:00"), kst("2026-07-13", "10:30")],
      [PROFESSOR_ID, kst("2026-07-13", "10:30"), kst("2026-07-13", "11:00")],
      [PROFESSOR_ID, kst("2026-07-13", "11:00"), kst("2026-07-13", "11:30")],
      [PROFESSOR_ID, kst("2026-07-13", "11:30"), kst("2026-07-13", "12:00")],
    ],
  );

  const bookable = chunks.filter((chunk) => chunk.kind === "bookable");
  // Only the chunk aligned with the row's start_time carries the row id — the
  // toggle flow deactivates the whole row via that id, while other chunks
  // write a dated blackout instead (legacy interaction, preserved).
  assert.deepEqual(
    bookable.map((chunk) => [chunk.day, chunk.start, chunk.end, chunk.id]),
    [
      [1, "10:00", "10:30", "row-1"],
      [1, "10:30", "11:00", undefined],
      [1, "11:00", "11:30", undefined],
      [1, "11:30", "12:00", undefined],
    ],
  );
  // The rest of Monday and every other weekday stay undeclared free time.
  assert.equal(chunksAt(chunks, 1, "09:00")[0]?.kind, "free");
  assert.equal(chunksAt(chunks, 1, "12:00")[0]?.kind, "free");
  assert.equal(chunks.filter((chunk) => chunk.day === 2 && chunk.kind === "bookable").length, 0);
});

test("pending and approved requests each leave a hole in the grid", () => {
  for (const status of ["pending", "approved"]) {
    const { chunks } = buildProfessorWeekAvailability(
      weekInput({
        availability: [activeWindow()],
        counselingRequests: [
          {
            status,
            requested_start: kst("2026-07-13", "10:00"),
            requested_end: kst("2026-07-13", "10:30"),
            suggested_start: null,
            suggested_end: null,
          },
        ],
      }),
    );

    assert.equal(
      chunksAt(chunks, 1, "10:00").length,
      0,
      `Mon 10:00 with a ${status} request must not be offered`,
    );
    assert.equal(chunksAt(chunks, 1, "10:30")[0]?.kind, "bookable");
  }
});

test("busy time derives from requested_*, matching the DB constraint, not suggested_*", () => {
  const { bookableSlots, chunks } = buildProfessorWeekAvailability(
    weekInput({
      availability: [activeWindow()],
      counselingRequests: [
        {
          status: "approved",
          requested_start: kst("2026-07-13", "10:00"),
          requested_end: kst("2026-07-13", "10:30"),
          suggested_start: kst("2026-07-13", "11:00"),
          suggested_end: kst("2026-07-13", "11:30"),
        },
      ],
    }),
  );

  // The exclusion constraint holds requested_start/end; suggested_* is advisory.
  assert.equal(chunksAt(chunks, 1, "10:00").length, 0, "requested time must be busy");
  assert.equal(chunksAt(chunks, 1, "11:00")[0]?.kind, "bookable", "suggested time stays open");
  assert.equal(
    bookableSlots.some((slot) => slot.start === kst("2026-07-13", "10:00")),
    false,
  );
  assert.equal(
    bookableSlots.some((slot) => slot.start === kst("2026-07-13", "11:00")),
    true,
  );
});

test("an inactive availability row blacks out every chunk it covers", () => {
  const { chunks } = buildProfessorWeekAvailability(
    weekInput({
      availability: [
        {
          id: "avail-1",
          day_of_week: 2,
          specific_date: null,
          start_time: "10:00:00",
          end_time: "11:00:00",
          slot_minutes: 30,
          is_active: false,
        },
      ],
    }),
  );

  const firstHalf = chunksAt(chunks, 2, "10:00");
  const secondHalf = chunksAt(chunks, 2, "10:30");
  assert.equal(firstHalf.length, 1);
  assert.equal(secondHalf.length, 1);
  assert.equal(firstHalf[0].kind, "blocked");
  assert.equal(secondHalf[0].kind, "blocked");
  assert.equal(firstHalf[0].isBlackout, true);
  assert.equal(secondHalf[0].isBlackout, true);
  assert.equal(firstHalf[0].id, "avail-1");
  assert.equal(secondHalf[0].id, "avail-1");
});

test("a dated blackout admin task suppresses only its date, ignoring day_of_week", () => {
  const { chunks } = buildProfessorWeekAvailability(
    weekInput({
      adminTasks: [
        {
          id: "task-1",
          title: "__BLACKOUT__2026-07-15",
          day_of_week: 1, // deliberately wrong — the embedded date must govern
          start_time: "09:00:00",
          end_time: "18:00:00",
        },
      ],
    }),
  );

  assert.equal(chunks.filter((chunk) => chunk.day === 3).length, 0, "Wed fully suppressed");
  assert.equal(chunks.filter((chunk) => chunk.day === 1).length > 0, true, "Mon unaffected");
});

test("a specific-date availability row binds only its date", () => {
  const { bookableSlots, chunks } = buildProfessorWeekAvailability(
    weekInput({
      availability: [
        activeWindow({
          id: "row-sd",
          day_of_week: 1, // deliberately wrong — specific_date must govern
          specific_date: "2026-07-14",
          end_time: "10:30:00",
        }),
      ],
    }),
  );

  assert.deepEqual(
    bookableSlots.map((slot) => [slot.start, slot.end]),
    [[kst("2026-07-14", "10:00"), kst("2026-07-14", "10:30")]],
  );
  assert.equal(chunksAt(chunks, 2, "10:00")[0]?.kind, "bookable");
  assert.equal(chunksAt(chunks, 1, "10:00")[0]?.kind, "free");
});
