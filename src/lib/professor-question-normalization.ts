import { createHash } from "node:crypto";
import type { ProfessorQuestionCategory } from "@/types/professor-questions";

const MAXIMUM_QUESTION_LENGTH = 2_000;
const QUESTION_CATEGORY_SET = new Set<string>([
  "과목 정보",
  "학사 행정",
  "수업 운영",
  "로드맵",
  "상담 필요",
] satisfies readonly ProfessorQuestionCategory[]);
const PUNCTUATION_OR_SYMBOL_PATTERN = /[\p{P}\p{S}]+/gu;
const WHITESPACE_PATTERN = /\s+/g;

export function validateProfessorQuestion(value: string) {
  const question = value.trim();
  return question && question.length <= MAXIMUM_QUESTION_LENGTH ? question : null;
}

export function normalizeQuestionCategory(value: string): ProfessorQuestionCategory | null {
  const category = value.trim();
  return QUESTION_CATEGORY_SET.has(category) ? (category as ProfessorQuestionCategory) : null;
}

export function normalizeProfessorQuestion(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(PUNCTUATION_OR_SYMBOL_PATTERN, " ")
    .replace(WHITESPACE_PATTERN, " ")
    .trim();
}

export function createQuestionFingerprint(value: string) {
  return createHash("sha256").update(normalizeProfessorQuestion(value), "utf8").digest("hex");
}

export function matchesQuestionPattern(question: string, pattern: string) {
  const normalizedQuestion = normalizeProfessorQuestion(question);
  const normalizedPattern = normalizeProfessorQuestion(pattern);
  return Boolean(normalizedPattern) && normalizedQuestion.includes(normalizedPattern);
}
