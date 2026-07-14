import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("mobile timetable uses a full-width bounded grid and overflow-safe course cells", async () => {
  const source = await readFile(new URL("./my-page-planner.tsx", import.meta.url), "utf8");

  assert.match(source, /w-full min-w-0 overflow-hidden/);
  assert.match(source, /gridTemplateColumns/);
  assert.match(source, /p-1(?:\.5)?/);
  assert.match(source, /line-clamp-2[^\"]*break-all[^\"]*text-\[11px\]/);
  assert.match(source, /truncate[^\"]*text-\[9px\]/);
  assert.match(source, /flex flex-col gap-0\.5/);
  assert.doesNotMatch(source, /min-w-\[600px\]/);
});
