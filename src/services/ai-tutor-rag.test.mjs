import assert from "node:assert/strict";
import { test } from "node:test";
import {
  selectTutorKnowledgeSources,
  sanitizeTutorCitations,
} from "./ai-tutor-rag.ts";

const courseId = "course-1";

test("ranks matching syllabus and announcement evidence before lower-priority sources", () => {
  const sources = selectTutorKnowledgeSources({
    courseId,
    question: "When is the midterm exam?",
    sources: [
      { id: "bluebook", courseId, type: "bluebook", title: "Curriculum", content: "Elective course", createdAt: null },
      { id: "notice", courseId, type: "announcement", title: "Midterm exam notice", content: "The midterm exam is in week 8.", createdAt: "2026-07-01" },
      { id: "syllabus", courseId, type: "syllabus", title: "Course syllabus", content: "Week 8: midterm exam", createdAt: null },
      { id: "other-course", courseId: "course-2", type: "announcement", title: "Midterm exam", content: "Do not include", createdAt: null },
    ],
  });

  assert.deepEqual(sources.map((source) => source.id), ["syllabus", "notice"]);
});

test("keeps only citations that belong to the retrieved evidence set", () => {
  const citations = sanitizeTutorCitations(["notice", "missing", "notice", "syllabus"], [
    { id: "syllabus", courseId, type: "syllabus", title: "Syllabus", content: "", createdAt: null },
    { id: "notice", courseId, type: "announcement", title: "Notice", content: "", createdAt: null },
  ]);

  assert.deepEqual(citations, ["notice", "syllabus"]);
});
