import assert from "node:assert/strict";
import test from "node:test";

import { isWithinQuietHours, normalizeNotificationPreferences } from "./notification-preferences.ts";

test("normalizes categories and quiet-hour values fail closed", () => {
  assert.deepEqual(normalizeNotificationPreferences({ categories: ["question", "unknown"], quietStart: "22:00", quietEnd: "07:00" }), {
    browserEnabled: false,
    categories: ["question"],
    quietStart: "22:00",
    quietEnd: "07:00",
  });
});

test("detects quiet hours that wrap across midnight", () => {
  assert.equal(isWithinQuietHours("23:30", "22:00", "07:00"), true);
  assert.equal(isWithinQuietHours("06:30", "22:00", "07:00"), true);
  assert.equal(isWithinQuietHours("12:00", "22:00", "07:00"), false);
});
