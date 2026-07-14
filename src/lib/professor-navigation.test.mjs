import assert from "node:assert/strict";
import test from "node:test";
import {
  professorCourseManagementItems,
  professorWeeklyPlanPreviewLink,
} from "./professor-navigation.ts";

test("exposes weekly plan preview from the professor course-management menu", () => {
  assert.deepEqual(
    { label: professorWeeklyPlanPreviewLink.label, href: professorWeeklyPlanPreviewLink.href },
    {
    label: "주간 계획 초안 검토",
    href: "/professor/weekly-plan-preview",
    },
  );
});

test("puts weekly plan review directly below roadmap edit and settings last", () => {
  assert.deepEqual(
    professorCourseManagementItems.map((item) => item.id),
    ["roadmap-edit", "weekly-plan-preview", "sensitive-request", "course-faq", "course-settings"],
  );
});
