import assert from "node:assert/strict";
import test from "node:test";

import {
  PACEMATE_TIME_ZONE,
  buildAvailableCounselingSlots,
  getCounselingSlotId,
  resolveSelectedCounselingSlot,
} from "./counseling-slots.ts";

const professor = {
  professorId: "11111111-1111-1111-1111-111111111111",
  professorName: "테스트 교수",
  professorOffice: null,
  professorEmail: null,
};

function baseInput() {
  return {
    now: new Date("2026-07-12T00:00:00.000Z"),
    timeZone: PACEMATE_TIME_ZONE,
    availability: [
      {
        ...professor,
        dayOfWeek: 1,
        specificDate: null,
        startTime: "10:00",
        endTime: "12:00",
        slotMinutes: 30,
        isActive: true,
      },
    ],
    teachingSlots: [],
    busyRequests: [],
    adminTasks: [],
  };
}

test("Asia/Seoul availability becomes the same UTC instant on every server timezone", () => {
  const slots = buildAvailableCounselingSlots(baseInput());

  assert.equal(slots[0]?.start, "2026-07-13T01:00:00.000Z");
  assert.equal(slots[0]?.end, "2026-07-13T01:30:00.000Z");
});

test("teaching, admin, blackout, and active request conflicts are excluded", () => {
  const input = baseInput();
  input.teachingSlots.push({
    professorId: professor.professorId,
    dayOfWeek: 1,
    startTime: "10:00",
    endTime: "10:30",
  });
  input.adminTasks.push({
    professorId: professor.professorId,
    title: "정기 회의",
    dayOfWeek: 1,
    startTime: "10:30",
    endTime: "11:00",
  });
  input.availability.push({
    ...professor,
    dayOfWeek: 1,
    specificDate: null,
    startTime: "11:00",
    endTime: "11:30",
    slotMinutes: 30,
    isActive: false,
  });
  input.busyRequests.push({
    professorId: professor.professorId,
    start: "2026-07-13T02:30:00.000Z",
    end: "2026-07-13T03:00:00.000Z",
  });

  const slots = buildAvailableCounselingSlots(input);

  assert.equal(slots.some((slot) => slot.start.startsWith("2026-07-13")), false);
});

test("student cutoff excludes slots ending after 18:00 local time", () => {
  const input = baseInput();
  input.availability[0] = {
    ...input.availability[0],
    startTime: "17:30",
    endTime: "18:30",
  };

  const slots = buildAvailableCounselingSlots(input);

  assert.equal(slots.length, 2);
  assert.equal(slots[0]?.start, "2026-07-13T08:30:00.000Z");
  assert.equal(slots[0]?.end, "2026-07-13T09:00:00.000Z");
  assert.equal(
    slots.every((slot) => slot.end.endsWith("T09:00:00.000Z")),
    true,
  );
});

test("duplicate availability rows produce one stable slot", () => {
  const input = baseInput();
  input.availability.push({ ...input.availability[0] });

  const slots = buildAvailableCounselingSlots(input);
  const ids = slots.map(getCounselingSlotId);

  assert.equal(ids.length, new Set(ids).size);
});

test("slot ids match across timestamp serializations of the same instant", () => {
  // Engine slots carry Date#toISOString() form; PostgREST returns timestamptz
  // as +00:00 form. Both must produce the same booking id.
  const fromEngine = getCounselingSlotId({
    professorId: professor.professorId,
    start: "2026-07-14T02:00:00.000Z",
    end: "2026-07-14T02:30:00.000Z",
  });
  const fromDatabase = getCounselingSlotId({
    professorId: professor.professorId,
    start: "2026-07-14T02:00:00+00:00",
    end: "2026-07-14T02:30:00+00:00",
  });

  assert.equal(fromDatabase, fromEngine);
});

test("selection ignores a valid slot id paired with a different date", () => {
  const slots = buildAvailableCounselingSlots(baseInput());

  assert.equal(
    resolveSelectedCounselingSlot(slots, "2026-07-20", getCounselingSlotId(slots[0])),
    null,
  );
});

test("one professor's dense availability cannot hide another professor's slots (per-professor cap)", () => {
  // Stage 4 audit A-2: the display cap used to be a global slice(0, 48) over
  // the merged chronological list, so a professor whose availability starts
  // later in the 14-day window rendered as "no slots" while genuinely
  // bookable. The cap must apply per professor.
  const professorB = {
    professorId: "22222222-2222-2222-2222-222222222222",
    professorName: "두번째 교수",
    professorOffice: null,
    professorEmail: null,
  };
  const input = baseInput();
  // Professor A: every weekday 09:00-18:00 → 18 slots/day, exceeds 48 within
  // the first three weekdays of the window.
  input.availability = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
    ...professor,
    dayOfWeek,
    specificDate: null,
    startTime: "09:00",
    endTime: "18:00",
    slotMinutes: 30,
    isActive: true,
  }));
  // Professor B: a single declared window in the second week of the horizon.
  input.availability.push({
    ...professorB,
    dayOfWeek: null,
    specificDate: "2026-07-23",
    startTime: "10:00",
    endTime: "11:00",
    slotMinutes: 30,
    isActive: true,
  });

  const slots = buildAvailableCounselingSlots(input);
  const bSlots = slots.filter((slot) => slot.professorId === professorB.professorId);
  const aSlots = slots.filter((slot) => slot.professorId === professor.professorId);

  assert.equal(bSlots.length, 2, "professor B's declared window must stay visible");
  assert.ok(aSlots.length <= 48, "each professor's list stays capped");
  assert.ok(aSlots.length > 0, "professor A keeps their earliest slots");
});

test("selection never falls back to the first slot when the selected id is empty or stale", () => {
  const slots = buildAvailableCounselingSlots(baseInput());
  const selectedDate = "2026-07-13";

  assert.equal(resolveSelectedCounselingSlot(slots, selectedDate, ""), null);
  assert.equal(resolveSelectedCounselingSlot(slots, selectedDate, "stale"), null);
  assert.equal(
    resolveSelectedCounselingSlot(slots, selectedDate, getCounselingSlotId(slots[1])),
    slots[1],
  );
});
