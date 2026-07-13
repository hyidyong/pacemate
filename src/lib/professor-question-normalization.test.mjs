import assert from "node:assert/strict";
import test from "node:test";

import {
  createQuestionFingerprint,
  matchesQuestionPattern,
  normalizeProfessorQuestion,
  normalizeQuestionCategory,
  validateProfessorQuestion,
} from "./professor-question-normalization.ts";

test("question normalization is stable across spacing, case, width, and punctuation", () => {
  const first = normalizeProfessorQuestion("  FAQ에  나온  내용인가요? ");
  const second = normalizeProfessorQuestion("ｆａｑ에 나온 내용인가요!");

  assert.equal(first, "faq에 나온 내용인가요");
  assert.equal(first, second);
  assert.equal(createQuestionFingerprint(first), createQuestionFingerprint(second));
});

test("only the fixed question taxonomy is accepted", () => {
  assert.equal(normalizeQuestionCategory("과목 정보"), "과목 정보");
  assert.equal(normalizeQuestionCategory(" 수업 운영 "), "수업 운영");
  assert.equal(normalizeQuestionCategory("임의 분류"), null);
});

test("question validation rejects empty and oversized bodies", () => {
  assert.equal(validateProfessorQuestion("   "), null);
  assert.equal(validateProfessorQuestion("a".repeat(2001)), null);
  assert.equal(validateProfessorQuestion("  질문입니다.  "), "질문입니다.");
});

test("auto reply patterns match only explicit normalized substrings", () => {
  assert.equal(matchesQuestionPattern("시험 일정은 언제인가요", "시험 일정"), true);
  assert.equal(matchesQuestionPattern("과제 제출일이 궁금합니다", "시험 일정"), false);
  assert.equal(matchesQuestionPattern("FAQ에 나온 내용인가요?", "ｆａｑ에 나온"), true);
});
