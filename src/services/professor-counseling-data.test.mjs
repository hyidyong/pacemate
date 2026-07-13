import assert from "node:assert/strict";
import test from "node:test";

import { normalizeProfessorCounselingRows } from "./professor-counseling-data.ts";

test("returns only persisted counseling rows without synthetic demo records", () => {
  const persisted = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      student_id: "22222222-2222-2222-2222-222222222222",
      requested_start: "2026-07-13T01:00:00.000Z",
      requested_end: "2026-07-13T01:30:00.000Z",
      topic: "수강 상담",
      location: null,
      status: "pending",
      professor_note: null,
      suggested_start: null,
      suggested_end: null,
      student: { name: "학생", identifier: "20260001" },
    },
  ];

  assert.deepEqual(normalizeProfessorCounselingRows(persisted), persisted);
  assert.equal(normalizeProfessorCounselingRows([]).length, 0);
});
