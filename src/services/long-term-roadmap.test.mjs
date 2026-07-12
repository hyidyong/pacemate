import assert from "node:assert/strict";
import test from "node:test";
import { buildElectronicEngineeringLongTermRoadmap } from "./long-term-roadmap.ts";

const preview = {
  kind: "preview",
  department: "electronic-engineering",
  version: {
    sourceVerified: false,
    admissionYearFrom: null,
    admissionYearTo: null,
    versionKey: "electronic-engineering-2026",
  },
  courses: [
    { id: "course-1", sourceCourseName: "기초전자회로", recommendedGrade: 1 },
    { id: "course-2", sourceCourseName: "전자기학", recommendedGrade: 2 },
    { id: "course-3", sourceCourseName: "반도체공학", recommendedGrade: 3 },
  ],
};

test("builds previous, current, and future phases without course metadata guesses", () => {
  const roadmap = buildElectronicEngineeringLongTermRoadmap(preview, {
    currentGrade: 2,
    currentSemester: 1,
    completedCourseIds: ["course-1"],
  });

  assert.deepEqual(roadmap.summary, {
    totalCourseCount: 3,
    completedCourseCount: 1,
    remainingCourseCount: 2,
  });
  assert.deepEqual(roadmap.phases.previous.courses[0], {
    id: "course-1",
    sourceCourseName: "기초전자회로",
    recommendedGrade: 1,
    status: "completed",
  });
  assert.equal(roadmap.phases.current.courses[0].status, "remaining");
  assert.equal(roadmap.phases.future.courses[0].recommendedGrade, 3);
  assert.equal("credits" in roadmap.phases.future.courses[0], false);
  assert.equal("recommendedSemester" in roadmap.phases.future.courses[0], false);
});

test("does not mutate or remove source curriculum courses", () => {
  const sourceCourses = preview.courses.map((course) => ({ ...course }));

  const roadmap = buildElectronicEngineeringLongTermRoadmap(preview, {
    currentGrade: 2,
    currentSemester: 2,
    completedCourseIds: ["course-1", "course-2"],
  });

  assert.equal(roadmap.summary.totalCourseCount, 3);
  assert.deepEqual(preview.courses, sourceCourses);
  assert.equal(
    roadmap.phases.previous.courses.length +
      roadmap.phases.current.courses.length +
      roadmap.phases.future.courses.length,
    3,
  );
});
