import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStudentCourseStudyGuideFallback,
  STUDENT_COURSE_STUDY_GUIDE_JSON_SCHEMA,
  validateStudentCourseStudyGuide,
} from "./student-course-study-guide.ts";

const syllabusInput = {
  courseName: "물권법",
  description: "담보물권의 법리와 판례를 학습합니다.",
  prerequisites: "민법총칙의 법률행위와 의사표시",
  weeks: [
    { weekNumber: 1, title: "물권법 서론", topic: "물권의 객체와 효력" },
    { weekNumber: 2, title: "물권변동", topic: "등기와 공시 원칙" },
    { weekNumber: 3, title: "소유권", topic: "소유권의 취득" },
  ],
  assessments: [
    { title: "중간고사", type: "midterm", weightPercent: 35 },
    { title: "기말고사", type: "final", weightPercent: 40 },
  ],
};

test("builds a strict syllabus-only baseline with real topics and no template filler", () => {
  const guide = buildStudentCourseStudyGuideFallback(syllabusInput);

  assert.equal(validateStudentCourseStudyGuide(guide), true);
  assert.equal(guide.personalized_content.is_applied, false);
  assert.equal(guide.personalized_content.target_area, "none");
  assert.equal(guide.personalized_content.additional_tips, "");
  assert.match(guide.preview_review_guide.content, /물권의 객체와 효력/);
  assert.match(guide.learning_method.content, /중간고사 35%/);
  assert.doesNotMatch(JSON.stringify(guide), /학습 계획 확인/);
});

test("adds weekly-log personalization without replacing the syllabus baseline", () => {
  const guide = buildStudentCourseStudyGuideFallback({
    ...syllabusInput,
    weeklyLog: [{ weekNumber: 2, difficultyLevel: 5, understandingLevel: 2, privateNote: "등기 예제가 어렵다" }],
    professorNotes: "소유권 판례를 비교하세요.",
  });

  assert.equal(validateStudentCourseStudyGuide(guide), true);
  assert.equal(guide.personalized_content.is_applied, true);
  assert.equal(guide.personalized_content.target_area, "weekly_log");
  assert.match(guide.personalized_content.additional_tips, /2주차/);
  assert.match(guide.personalized_content.additional_tips, /소유권 판례/);
  assert.match(guide.course_summary, /담보물권/);
});

test("declares a closed JSON schema and rejects meaningless template output", () => {
  assert.equal(STUDENT_COURSE_STUDY_GUIDE_JSON_SCHEMA.additionalProperties, false);
  assert.equal(STUDENT_COURSE_STUDY_GUIDE_JSON_SCHEMA.properties.learning_method.additionalProperties, false);

  const guide = buildStudentCourseStudyGuideFallback(syllabusInput);
  assert.equal(validateStudentCourseStudyGuide({
    ...guide,
    preview_review_guide: { ...guide.preview_review_guide, content: "학습 계획 확인" },
  }), false);
});
