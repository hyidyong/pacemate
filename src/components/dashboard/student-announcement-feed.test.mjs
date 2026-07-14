import assert from "node:assert/strict";
import test from "node:test";
import { filterVisibleAnnouncements } from "./student-announcement-feed.tsx";

test("filters only notice ids dismissed by the current browser", () => {
  assert.deepEqual(
    filterVisibleAnnouncements([{ id: "notice-a" }, { id: "notice-b" }], new Set(["notice-a"])).map((notice) => notice.id),
    ["notice-b"],
  );
});
