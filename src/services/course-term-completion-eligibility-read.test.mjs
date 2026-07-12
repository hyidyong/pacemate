import assert from "node:assert/strict";
import test from "node:test";
import {
  ELIGIBILITY_SELECT,
  mapCourseTermCompletionEligibilityInput,
} from "./course-term-completion-eligibility-read.ts";
import { normalizeUuid } from "../lib/uuid.ts";

test("rejects an empty offering id", () => {
  assert.equal(normalizeUuid(""), null);
});

test("rejects a whitespace-only offering id", () => {
  assert.equal(normalizeUuid("   "), null);
});

test("rejects a non-UUID offering id", () => {
  assert.equal(normalizeUuid("company-law"), null);
});

test("trims and preserves a valid UUID offering id", () => {
  const uuid = "11111111-1111-4111-8111-111111111111";
  assert.equal(normalizeUuid(`  ${uuid}  `), uuid);
});

test("accepts a canonical UUID v7-shaped value", () => {
  const uuid = "018f2f3a-7abc-7def-8abc-1234567890ab";
  assert.equal(normalizeUuid(uuid), uuid);
});

test("rejects a UUID with an invalid length", () => {
  assert.equal(normalizeUuid("11111111-1111-1111-1111-11111111111"), null);
});

test("uses only the eligibility columns and excludes sensitive progress fields", () => {
  assert.deepEqual(ELIGIBILITY_SELECT, {
    term: "id, semester_label",
    offering: "id, course_id, term_id",
    weeklyPlan: "offering_id, week_number, review_required, professor_confirmed",
    weeklyProgress: "student_id, offering_id, week_number, progress_status_override",
  });

  assert.equal(ELIGIBILITY_SELECT.weeklyProgress.includes("private_note"), false);
  assert.equal(ELIGIBILITY_SELECT.weeklyProgress.includes("shared_feedback"), false);
  assert.equal(ELIGIBILITY_SELECT.weeklyProgress.includes("share_feedback_with_professor"), false);
  assert.equal(ELIGIBILITY_SELECT.weeklyProgress.includes("use_private_note_for_ai"), false);
});

test("maps database rows without changing null or unknown progress statuses", () => {
  const mapped = mapCourseTermCompletionEligibilityInput({
    plans: [
      {
        offering_id: "offering-1",
        week_number: 1,
        review_required: false,
        professor_confirmed: true,
      },
    ],
    progress: [
      {
        student_id: "profile-1",
        offering_id: "offering-1",
        week_number: 1,
        progress_status_override: null,
      },
      {
        student_id: "profile-1",
        offering_id: "offering-1",
        week_number: 2,
        progress_status_override: "unknown_status",
      },
    ],
  });

  assert.deepEqual(mapped, {
    approvedWeeklyPlan: [
      {
        week_number: 1,
        review_required: false,
        professor_confirmed: true,
      },
    ],
    studentWeeklyProgress: [
      {
        week_number: 1,
        progress_status_override: null,
      },
      {
        week_number: 2,
        progress_status_override: "unknown_status",
      },
    ],
  });
});
