import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile("src/components/mypage/my-page-section-tabs.tsx", "utf8");

test("mypage section tabs expose the four icon-only filter states", () => {
  for (const state of ['id: "all"', 'id: "timetable"', 'id: "todo"', 'id: "community"']) {
    assert.match(source, new RegExp(state));
  }
  assert.match(source, /aria-label=\{label\}/);
  assert.match(source, /bg-blue-50 text-blue-600 shadow-sm/);
});
