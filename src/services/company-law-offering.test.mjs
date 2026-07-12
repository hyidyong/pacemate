import assert from "node:assert/strict";
import test from "node:test";
import { selectCompanyLawOffering } from "./company-law-offering.ts";

const assignedOfferingId = "11111111-1111-4111-8111-111111111111";
const unassignedOfferingId = "22222222-2222-4222-8222-222222222222";

test("selects only an assigned company law offering for the requested term", () => {
  const result = selectCompanyLawOffering(
    [assignedOfferingId],
    [
      {
        id: unassignedOfferingId,
        course: { name: "회사법" },
        academic_term: { semester_label: "2026-2" },
      },
      {
        id: assignedOfferingId,
        course: { name: "회사법" },
        academic_term: { semester_label: "2026-2" },
      },
    ],
  );

  assert.deepEqual(result, {
    ok: true,
    offeringId: assignedOfferingId,
    courseName: "회사법",
    semesterLabel: "2026-2",
  });
});

test("fails closed when multiple assigned offerings match", () => {
  const result = selectCompanyLawOffering(
    [assignedOfferingId, unassignedOfferingId],
    [
      {
        id: assignedOfferingId,
        course: { name: "회사법" },
        academic_term: { semester_label: "2026-2" },
      },
      {
        id: unassignedOfferingId,
        course: { name: "회사법" },
        academic_term: { semester_label: "2026-2" },
      },
    ],
  );

  assert.deepEqual(result, { ok: false, code: "database_read_failed" });
});

test("returns offering_not_found when no assigned offering matches", () => {
  const result = selectCompanyLawOffering(
    [assignedOfferingId],
    [
      {
        id: assignedOfferingId,
        course: { name: "민법" },
        academic_term: { semester_label: "2026-2" },
      },
    ],
  );

  assert.deepEqual(result, { ok: false, code: "offering_not_found" });
});
