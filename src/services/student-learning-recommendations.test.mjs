import assert from "node:assert/strict";
import test from "node:test";

import { buildStudentLearningRecommendations } from "./student-learning-recommendations.ts";

test("recommends the first unfinished approved week with evidence", () => {
  const plans = Array.from({ length: 15 }, (_, index) => ({ weekNumber: index + 1, approved: true }));
  const progress = Array.from({ length: 15 }, (_, index) => ({
    weekNumber: index + 1,
    status: index < 4 ? "covered" : "not_started",
  }));
  const result = buildStudentLearningRecommendations({ courseName: "회사법", plans, progress });
  assert.equal(result[0]?.weekNumber, 5);
  assert.match(result[0]?.reason ?? "", /미완료/);
});

test("prioritizes a needs-review week over the next unfinished week", () => {
  const result = buildStudentLearningRecommendations({
    courseName: "회사법",
    plans: [{ weekNumber: 2, approved: true }, { weekNumber: 3, approved: true }],
    progress: [{ weekNumber: 2, status: "needs_review" }, { weekNumber: 3, status: "not_started" }],
  });
  assert.equal(result[0]?.type, "review_week");
  assert.equal(result[0]?.weekNumber, 2);
});

test("fails closed when no approved plan evidence exists", () => {
  assert.deepEqual(buildStudentLearningRecommendations({ courseName: "회사법", plans: [], progress: [] }), []);
});
