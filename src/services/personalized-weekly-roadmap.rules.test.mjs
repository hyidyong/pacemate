import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile("src/services/personalized-weekly-roadmap.rules.ts", "utf8");

test("returns rule-based fallback rows for all fifteen weeks", () => {
  assert.match(source, /normalizeWeeklyBaseline\(baseline\)\.map/);
  assert.match(source, /generationStatus:\s*"fallback"/);
  assert.match(source, /generatedByAi:\s*false/);
});

test("requires regeneration when a source or onboarding hash changes", () => {
  assert.match(source, /saved\.sourceVersion !== sourceVersion/);
  assert.match(source, /saved\.onboardingHash !== onboardingHash/);
  assert.match(source, /saved\.inputHash !== inputHash/);
});
