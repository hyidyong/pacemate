import assert from "node:assert/strict";
import test from "node:test";

import { selectGroundedCourseSources } from "./course-knowledge-retrieval.ts";

const courseId = "11111111-1111-1111-1111-111111111111";

test("prioritizes an exact approved FAQ match", () => {
  const result = selectGroundedCourseSources({
    courseId,
    question: "중간고사 범위는 어디까지인가요?",
    sources: [
      { id: "faq-1", courseId, type: "faq", title: "중간고사 범위는 어디까지인가요?", content: "1주차부터 7주차입니다.", approved: true },
      { id: "notice-1", courseId, type: "notice", title: "시험 안내", content: "중간고사 안내입니다.", approved: true },
    ],
  });

  assert.equal(result[0]?.id, "faq-1");
});

test("rejects cross-course and unapproved sources", () => {
  const result = selectGroundedCourseSources({
    courseId,
    question: "과제 제출 일정",
    sources: [
      { id: "other", courseId: "22222222-2222-2222-2222-222222222222", type: "faq", title: "과제 제출 일정", content: "내일", approved: true },
      { id: "draft", courseId, type: "weekly_plan", title: "과제 제출 일정", content: "이번 주", approved: false },
    ],
  });

  assert.deepEqual(result, []);
});

test("returns no evidence when normalized keywords do not overlap", () => {
  const result = selectGroundedCourseSources({
    courseId,
    question: "출석 기준",
    sources: [
      { id: "faq-2", courseId, type: "faq", title: "교재", content: "지정 교재 안내", approved: true },
    ],
  });

  assert.deepEqual(result, []);
});
