import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile("src/components/dashboard/student-announcement-feed.tsx", "utf8");

test("student announcement feed supports browser-local dismissed notice ids", () => {
  assert.match(source, /filterVisibleAnnouncements/);
  assert.match(source, /dismissedIds\.has\(announcement\.id\)/);
  assert.match(source, /localStorage\.setItem/);
  assert.match(source, /shadow-sm/);
});
