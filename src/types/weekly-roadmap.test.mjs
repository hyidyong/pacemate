import assert from "node:assert/strict";
import test from "node:test";
import { deriveWeeklyPlanStatus } from "./weekly-roadmap.ts";

const approvedWeeks = Array.from({ length: 15 }, () => ({
  review_required: false,
  professor_confirmed: true,
}));

test("derives approved only when all 15 persisted weeks are confirmed", () => {
  assert.equal(deriveWeeklyPlanStatus([]), "draft");
  assert.equal(deriveWeeklyPlanStatus(approvedWeeks), "approved");
  assert.equal(
    deriveWeeklyPlanStatus(
      approvedWeeks.map((week, index) => index === 14 ? { ...week, professor_confirmed: false } : week),
    ),
    "draft",
  );
});

test("does not treat partial persisted plans as approved", () => {
  assert.equal(deriveWeeklyPlanStatus(approvedWeeks.slice(0, 14)), "draft");
});
