import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps the selected timetable offering in the roadmap URL", async () => {
  const source = await readFile(new URL("./student-roadmap-workspace.tsx", import.meta.url), "utf8");

  assert.match(source, /router\.push\(`\/roadmap\?offering=\$\{encodeURIComponent\(nextOfferingId\)\}`\)/);
});

test("shows completed week controls with the completed style before the active style", async () => {
  const source = await readFile(new URL("./student-roadmap-workspace.tsx", import.meta.url), "utf8");
  const completedMatch = /completed\s*\?\s*"bg-green-50 text-green-600 shadow-sm"/.exec(source);
  const activeMatch = /number === activeWeek\s*\?\s*"bg-blue-50 text-blue-600 shadow-sm"/.exec(source);
  const completedIndex = completedMatch?.index ?? -1;
  const activeIndex = activeMatch?.index ?? -1;

  assert.ok(completedIndex >= 0, "completed state style is missing");
  assert.ok(activeIndex >= 0, "active state style is missing");
  assert.ok(completedIndex < activeIndex, "completed state must take priority over active state");
});
