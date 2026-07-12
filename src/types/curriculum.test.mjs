import assert from "node:assert/strict";
import test from "node:test";
import {
  createUnsupportedCurriculumResult,
  mapCurriculumCourseRow,
  resolveSupportedDepartment,
} from "./curriculum.ts";

test("resolves only the two supported curriculum departments", () => {
  assert.equal(resolveSupportedDepartment("law"), "law");
  assert.equal(resolveSupportedDepartment("electronic-engineering"), "electronic-engineering");
  assert.equal(resolveSupportedDepartment("computer-science"), null);
  assert.equal(resolveSupportedDepartment("법학과"), null);
  assert.deepEqual(createUnsupportedCurriculumResult("computer-science"), {
    kind: "unsupported",
    department: "computer-science",
    supportedDepartments: ["law", "electronic-engineering"],
  });
});

test("preserves draft course uncertainty in the typed DTO", () => {
  const row = {
    id: "course-row",
    curriculum_version_id: "version-id",
    course_id: null,
    source_course_name: "전자회로",
    source_course_code: null,
    credits: null,
    requirement_type: "other",
    recommended_grade: 1,
    recommended_semester: null,
    curriculum_level: "major",
    is_required: false,
    source_page: 4,
    sort_order: 1,
    metadata: { matchStatus: "unresolved" },
  };

  assert.deepEqual(mapCurriculumCourseRow(row), {
    id: "course-row",
    curriculumVersionId: "version-id",
    courseId: null,
    sourceCourseName: "전자회로",
    sourceCourseCode: null,
    credits: null,
    requirementType: "other",
    recommendedGrade: 1,
    recommendedSemester: null,
    curriculumLevel: "major",
    isRequired: false,
    sourcePage: 4,
    sortOrder: 1,
    metadata: { matchStatus: "unresolved" },
  });
});
