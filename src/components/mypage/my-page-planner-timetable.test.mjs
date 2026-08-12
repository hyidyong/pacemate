import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("mobile timetable scrolls horizontally with a legible min-width grid (Stage 4, audit C-7)", async () => {
  const source = await readFile(new URL("./my-page-planner.tsx", import.meta.url), "utf8");

  // Deliberate Stage 4 change: the old overflow-hidden wrapper compressed
  // seven day columns into ~39px at 375px. The grid now scrolls inside an
  // overflow-x-auto wrapper with a 560px floor below sm.
  assert.match(source, /w-full min-w-0 overflow-x-auto/);
  assert.match(source, /min-w-\[560px\][^"]*sm:min-w-0/);
  assert.match(source, /repeat\(\$\{days\.length\}, minmax\(0, 1fr\)\)/);
  assert.match(source, /const days = \["월", "화", "수", "목", "금", "토", "일"\]/);
  assert.match(source, /timetableStartHour/);
  assert.match(source, /p-1(?:\.5)?/);
  assert.match(source, /line-clamp-2[^\"]*break-all[^\"]*text-\[11px\]/);
  assert.match(source, /truncate[^\"]*text-\[9px\]/);
  assert.match(source, /flex[^\"]*flex-col[^\"]*gap-0\.5/);
});
