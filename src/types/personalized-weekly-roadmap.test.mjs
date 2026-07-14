import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeWeeklyBaseline,
  validateAiWeeklyRoadmaps,
} from "./personalized-weekly-roadmap.ts";

test("normalizes sparse approved plans into fifteen ordered weeks", () => {
  const weeks = normalizeWeeklyBaseline([
    { weekNumber: 2, title: "계약", topic: "계약법", content: "청약과 승낙" },
  ]);

  assert.equal(weeks.length, 15);
  assert.equal(weeks[0].weekNumber, 1);
  assert.match(weeks[0].title, /1주차/);
  assert.deepEqual(weeks[1], {
    weekNumber: 2,
    title: "계약",
    topic: "계약법",
    content: "청약과 승낙",
  });
});

test("rejects AI output that does not contain all fifteen distinct weeks", () => {
  const incomplete = Array.from({ length: 14 }, (_, index) => ({
    weekNumber: index + 1,
    personalizedGoal: "핵심 개념 이해",
    learningActivities: ["강의 노트 정리"],
    reviewGuide: "핵심 용어를 복습합니다.",
  }));

  assert.deepEqual(validateAiWeeklyRoadmaps(incomplete), {
    ok: false,
    reason: "fifteen_weeks_required",
  });
});
