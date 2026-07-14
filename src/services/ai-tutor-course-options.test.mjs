import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const serviceSource = await readFile(new URL("./professor-questions.server.ts", import.meta.url), "utf8");
const pageSource = await readFile(new URL("../app/chatbot/page.tsx", import.meta.url), "utf8");

test("AI tutor course options come directly from the student's enrolled timetable courses", () => {
  const tutorLoader = serviceSource.split("export async function getStudentAiTutorCourses")[1].split("async function getStudentQuestionCourses")[0];
  assert.match(serviceSource, /export async function getStudentAiTutorCourses/);
  assert.match(tutorLoader, /from\("student_courses"\)/);
  assert.match(tutorLoader, /from\("courses"\)/);
  assert.match(tutorLoader, /eq\("student_id", profile\.id\)/);
  assert.doesNotMatch(tutorLoader, /course_professors/);
});

test("chatbot page uses the timetable-scoped tutor course loader", () => {
  assert.match(pageSource, /getStudentAiTutorCourses/);
  assert.doesNotMatch(pageSource, /getStudentProfessorQuestionData/);
});
