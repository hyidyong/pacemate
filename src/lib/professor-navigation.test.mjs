import assert from "node:assert/strict";
import test from "node:test";
import { professorWeeklyPlanPreviewLink } from "./professor-navigation.ts";

test("exposes weekly plan preview from the professor course-management menu", () => {
  assert.deepEqual(professorWeeklyPlanPreviewLink, {
    label: "주간 계획 초안 검토",
    href: "/professor/weekly-plan-preview",
  });
});
