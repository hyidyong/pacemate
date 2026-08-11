import assert from "node:assert/strict";
import test from "node:test";
import { selectOfferingIdForCourse } from "./student-timetable.rules.ts";

test("links the offering when the course has exactly one for the semester", () => {
  assert.equal(
    selectOfferingIdForCourse([{ id: "offer-1" }]),
    "offer-1",
  );
});

test("returns null when the course has no offering for the semester", () => {
  assert.equal(selectOfferingIdForCourse([]), null);
});

test("returns null when the offering is ambiguous (multiple sections)", () => {
  assert.equal(
    selectOfferingIdForCourse([{ id: "offer-1" }, { id: "offer-2" }]),
    null,
  );
});

test("ignores rows without a usable id", () => {
  assert.equal(selectOfferingIdForCourse([{ id: "" }]), null);
  assert.equal(selectOfferingIdForCourse([{ id: null }]), null);
});
