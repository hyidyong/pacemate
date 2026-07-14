import test from "node:test";
import assert from "node:assert/strict";
import { parseSyllabusText } from "./syllabus-parser.mjs";

test("parses explicit course, schedule, assessment, and week fields without inventing missing data", () => {
  const parsed = parseSyllabusText(`
    교과목명: 민사소송법(2)
    교과목코드: 21139-01
    담당교수: 손희정
    학점: 3
    수업시간: 화 09:00-10:15, 목 15:00-16:15
    평가방법: 출석 20%, 중간고사 30%, 기말고사 30%, 과제 20%
    1주차 민사소송의 의의와 목적
    2주차 소송요건
  `);

  assert.equal(parsed.course.name, "민사소송법(2)");
  assert.equal(parsed.course.code, "21139-01");
  assert.equal(parsed.course.professorName, "손희정");
  assert.deepEqual(parsed.schedules, [
    { dayOfWeek: "화", startTime: "09:00", endTime: "10:15", classroom: null },
    { dayOfWeek: "목", startTime: "15:00", endTime: "16:15", classroom: null },
  ]);
  assert.deepEqual(parsed.assessments.map(({ type, weightPercent }) => ({ type, weightPercent })), [
    { type: "attendance", weightPercent: 20 },
    { type: "midterm", weightPercent: 30 },
    { type: "final", weightPercent: 30 },
    { type: "assignment", weightPercent: 20 },
  ]);
  assert.equal(parsed.weeks[0].title, "민사소송의 의의와 목적");
  assert.equal(parsed.weeks[1].title, "소송요건");
  assert.equal(parsed.course.department, null);
});

test("keeps unknown syllabus fields null and limits weeks to 1 through 15", () => {
  const parsed = parseSyllabusText("교과목명: 보험해상법\n16주차 종강");

  assert.equal(parsed.course.name, "보험해상법");
  assert.equal(parsed.course.code, null);
  assert.equal(parsed.weeks.length, 0);
  assert.ok(parsed.warnings.some((warning) => warning.includes("weekly plan")));
});

test("parses the compact label layout emitted by the university PDF export", () => {
  const parsed = parseSyllabusText([
    "2026학년도 1학기 강의계획서",
    "교과목명민사소송법(2)교과목코드21139-01",
    "이수구분전공선택학점3성적부여방법등급",
    "담당교수박성은강의시간화09:00~10:15 목15:00~16:15",
    "반영비율(%)20.0040.0030.0010.00100",
    "1주차",
    "강의소개 및 민사소송 절차 개관",
    "8주차",
    "중간고사 및 문제풀이",
    "15주차",
    "기말평가",
  ].join("\n"));

  assert.equal(parsed.course.name, "민사소송법(2)");
  assert.equal(parsed.course.credits, 3);
  assert.equal(parsed.weeks.length, 3);
  assert.equal(parsed.weeks[1].title, "중간고사 및 문제풀이");
  assert.deepEqual(parsed.assessments.map((item) => item.weightPercent), [20, 40, 30, 10]);
  assert.equal(parsed.schedules.length, 2);
});
