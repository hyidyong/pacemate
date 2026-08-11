import assert from "node:assert/strict";
import test from "node:test";

import {
  PACEMATE_TIME_ZONE,
  buildAvailableCounselingSlots,
  getCounselingSlotId,
  instantToLocalParts,
  timeToMinutes,
} from "./counseling-slots.ts";
import { buildProfessorWeekAvailability } from "./calendar-utils.ts";

// Stage 2 exit-gate invariant (#28/#29): given the same canonical source data,
// the student counseling engine and the professor week grid must agree on
// student-bookable availability — compared by slot IDENTITY (professor + start
// + end instants), never by counts. The authoritative booking path
// (createCounselingRequest) re-validates against buildAvailableCounselingSlots
// itself, so agreement with the student engine IS agreement with booking
// eligibility.
//
// now = Sun 2026-07-12 09:00 KST → horizon (+1..+14) covers exactly the
// weekdays of the two displayed weeks: 7/13-7/17 and 7/20-7/24.

const PROF_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROF_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const NOW = new Date("2026-07-12T00:00:00.000Z");
const WEEK_1 = ["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17"];
const WEEK_2 = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24"];

function kst(dateKey, time) {
  return new Date(`${dateKey}T${time}:00+09:00`).toISOString();
}

// One neutral fixture, mapped into each consumer's input shape below.
// Professor A: a deliberately messy but realistic schedule.
const availabilityRows = [
  // recurring Monday window, 30-min slots
  { id: "a1", professorId: PROF_A, dayOfWeek: 1, specificDate: null, start: "10:00", end: "12:00", slotMinutes: 30, isActive: true },
  // recurring Tuesday blackout inside the hour-slot window below
  { id: "a2", professorId: PROF_A, dayOfWeek: 2, specificDate: null, start: "14:00", end: "15:00", slotMinutes: 30, isActive: false },
  // recurring Tuesday window, 60-min slots
  { id: "a3", professorId: PROF_A, dayOfWeek: 2, specificDate: null, start: "13:00", end: "16:00", slotMinutes: 60, isActive: true },
  // one-off Wednesday morning window (first week only)
  { id: "a4", professorId: PROF_A, dayOfWeek: 3, specificDate: "2026-07-15", start: "09:00", end: "10:00", slotMinutes: 30, isActive: true },
];

const teachingRows = [
  { professorId: PROF_A, dayOfWeek: 1, start: "11:00", end: "11:30" },
  { professorId: PROF_B, dayOfWeek: 2, start: "09:00", end: "12:00" },
];

const adminRows = [
  { id: "t1", professorId: PROF_A, title: "정기 회의", dayOfWeek: 1, start: "09:00", end: "10:30" },
  // dated blackout wipes the second Tuesday; its day_of_week is wrong on purpose
  { id: "t2", professorId: PROF_A, title: "__BLACKOUT__2026-07-21", dayOfWeek: 5, start: "09:00", end: "18:00" },
  { id: "t3", professorId: PROF_B, title: "학과 회의", dayOfWeek: 3, start: "13:00", end: "15:00" },
];

const requestRows = [
  // blocking: pending + approved on the first Monday
  { professorId: PROF_A, status: "pending", requestedStart: kst("2026-07-13", "10:30"), requestedEnd: kst("2026-07-13", "11:00"), suggestedStart: null, suggestedEnd: null },
  { professorId: PROF_A, status: "approved", requestedStart: kst("2026-07-13", "11:30"), requestedEnd: kst("2026-07-13", "12:00"), suggestedStart: null, suggestedEnd: null },
  // approved with divergent suggested_*: requested blocks, suggested must not
  { professorId: PROF_A, status: "approved", requestedStart: kst("2026-07-14", "15:00"), requestedEnd: kst("2026-07-14", "16:00"), suggestedStart: kst("2026-07-14", "13:00"), suggestedEnd: kst("2026-07-14", "13:30") },
  // non-blocking statuses over otherwise-bookable time
  { professorId: PROF_A, status: "cancelled", requestedStart: kst("2026-07-14", "13:00"), requestedEnd: kst("2026-07-14", "14:00"), suggestedStart: null, suggestedEnd: null },
  { professorId: PROF_A, status: "rejected", requestedStart: kst("2026-07-13", "10:00"), requestedEnd: kst("2026-07-13", "10:30"), suggestedStart: kst("2026-07-13", "10:00"), suggestedEnd: kst("2026-07-13", "10:30") },
  { professorId: PROF_B, status: "pending", requestedStart: kst("2026-07-13", "14:00"), requestedEnd: kst("2026-07-13", "14:30"), suggestedStart: null, suggestedEnd: null },
];

// --- student engine input (all professors together, camelCase shapes) -------

function studentEngineInput() {
  return {
    now: NOW,
    timeZone: PACEMATE_TIME_ZONE,
    availability: availabilityRows.map((row) => ({
      professorId: row.professorId,
      professorName: "교수",
      professorOffice: null,
      professorEmail: null,
      dayOfWeek: row.dayOfWeek,
      specificDate: row.specificDate,
      startTime: row.start,
      endTime: row.end,
      slotMinutes: row.slotMinutes,
      isActive: row.isActive,
    })),
    teachingSlots: teachingRows.map((row) => ({
      professorId: row.professorId,
      dayOfWeek: row.dayOfWeek,
      startTime: row.start,
      endTime: row.end,
    })),
    busyRequests: requestRows
      .filter((row) => row.status === "pending" || row.status === "approved")
      .map((row) => ({
        professorId: row.professorId,
        start: row.requestedStart,
        end: row.requestedEnd,
      })),
    adminTasks: adminRows.map((row) => ({
      professorId: row.professorId,
      title: row.title,
      dayOfWeek: row.dayOfWeek,
      startTime: row.start,
      endTime: row.end,
    })),
  };
}

// --- professor week adapter input (professor-scoped, DB row shapes) ---------

function weekInputFor(professorId, weekDateKeys) {
  return {
    professorId,
    weekDateKeys,
    availability: availabilityRows
      .filter((row) => row.professorId === professorId)
      .map((row) => ({
        id: row.id,
        day_of_week: row.dayOfWeek,
        specific_date: row.specificDate,
        start_time: `${row.start}:00`,
        end_time: `${row.end}:00`,
        slot_minutes: row.slotMinutes,
        is_active: row.isActive,
      })),
    teachingSlots: teachingRows
      .filter((row) => row.professorId === professorId)
      .map((row) => ({
        day_of_week: row.dayOfWeek,
        start_time: `${row.start}:00`,
        end_time: `${row.end}:00`,
      })),
    adminTasks: adminRows
      .filter((row) => row.professorId === professorId)
      .map((row) => ({
        id: row.id,
        title: row.title,
        day_of_week: row.dayOfWeek,
        start_time: `${row.start}:00`,
        end_time: `${row.end}:00`,
      })),
    // The professor calendar feed carries pending+approved only
    // (getCalendarRequests), matching the student engine's busy filter.
    counselingRequests: requestRows
      .filter((row) => row.professorId === professorId)
      .map((row) => ({
        status: row.status,
        requested_start: row.requestedStart,
        requested_end: row.requestedEnd,
        suggested_start: row.suggestedStart,
        suggested_end: row.suggestedEnd,
      })),
  };
}

function idsOf(slots) {
  return new Set(slots.map(getCounselingSlotId));
}

test("student engine and professor week grid agree on slot identities for every professor", () => {
  const studentSlots = buildAvailableCounselingSlots(studentEngineInput());

  for (const professorId of [PROF_A, PROF_B]) {
    const studentIds = idsOf(studentSlots.filter((slot) => slot.professorId === professorId));
    const professorIds = idsOf([
      ...buildProfessorWeekAvailability(weekInputFor(professorId, WEEK_1)).bookableSlots,
      ...buildProfessorWeekAvailability(weekInputFor(professorId, WEEK_2)).bookableSlots,
    ]);

    assert.deepEqual(
      [...professorIds].sort(),
      [...studentIds].sort(),
      `slot identity sets diverge for ${professorId}`,
    );
  }
});

test("the shared dataset exercises asymmetric weeks and every status, not a trivial case", () => {
  const studentSlots = buildAvailableCounselingSlots(studentEngineInput());
  const byProfessor = (professorId) =>
    studentSlots.filter((slot) => slot.professorId === professorId).map((slot) => slot.start);

  // Prof A: Mon 7/13 fully consumed (admin+pending+teaching+approved);
  // Mon 7/20 keeps the two chunks its recurring busy sources leave open;
  // Tue 7/14 keeps only 13:00 (blackout row kills 14:00, requested_* kills
  // 15:00, cancelled/suggested at 13:00 must NOT kill it);
  // Tue 7/21 wiped by the dated blackout; Wed window fires 7/15 only.
  assert.deepEqual(byProfessor(PROF_A), [
    kst("2026-07-14", "13:00"),
    kst("2026-07-15", "09:00"),
    kst("2026-07-15", "09:30"),
    kst("2026-07-20", "10:30"),
    kst("2026-07-20", "11:30"),
  ]);
  // Prof B declared nothing → nothing bookable despite busy sources existing.
  assert.deepEqual(byProfessor(PROF_B), []);
});

test("grid chunks classified bookable cover exactly the canonical slot intervals", () => {
  for (const professorId of [PROF_A, PROF_B]) {
    for (const week of [WEEK_1, WEEK_2]) {
      const { bookableSlots, chunks } = buildProfessorWeekAvailability(
        weekInputFor(professorId, week),
      );

      const coverByDate = new Map();
      for (const slot of bookableSlots) {
        const start = instantToLocalParts(slot.start, PACEMATE_TIME_ZONE);
        const end = instantToLocalParts(slot.end, PACEMATE_TIME_ZONE);
        const ranges = coverByDate.get(start.dateKey) ?? [];
        ranges.push({ start: start.minutesOfDay, end: end.minutesOfDay });
        coverByDate.set(start.dateKey, ranges);
      }

      for (const chunk of chunks) {
        const ranges = coverByDate.get(chunk.specificDate) ?? [];
        const chunkStart = timeToMinutes(chunk.start);
        const chunkEnd = timeToMinutes(chunk.end);
        const overlapsCover = ranges.some(
          (range) => chunkStart < range.end && range.start < chunkEnd,
        );

        assert.equal(
          chunk.kind === "bookable",
          overlapsCover,
          `${professorId} ${chunk.specificDate} ${chunk.start} classified ${chunk.kind} but cover overlap is ${overlapsCover}`,
        );
      }
    }
  }
});
