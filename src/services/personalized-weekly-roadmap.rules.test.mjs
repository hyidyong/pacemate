import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFallbackRoadmaps,
  shouldRegeneratePersonalizedRoadmap,
} from "./personalized-weekly-roadmap.rules.ts";

test("returns rule-based fallback rows for all fifteen weeks", () => {
  const rows = buildFallbackRoadmaps([], 3, "profile-hash", "input-hash");

  assert.equal(rows.length, 15);
  assert.equal(rows[0].generationStatus, "fallback");
  assert.equal(rows[0].sourceVersion, 3);
});

test("requires regeneration when a source or onboarding hash changes", () => {
  const saved = { sourceVersion: 3, onboardingHash: "profile-a", inputHash: "input-a" };

  assert.equal(shouldRegeneratePersonalizedRoadmap(saved, 3, "profile-a", "input-a"), false);
  assert.equal(shouldRegeneratePersonalizedRoadmap(saved, 4, "profile-a", "input-a"), true);
  assert.equal(shouldRegeneratePersonalizedRoadmap(saved, 3, "profile-b", "input-a"), true);
});
