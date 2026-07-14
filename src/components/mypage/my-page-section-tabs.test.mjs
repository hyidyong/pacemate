import assert from "node:assert/strict";
import test from "node:test";
import { shouldRenderMyPageSection } from "./my-page-section-tabs.tsx";

test("all renders every section and a selected icon renders only its section", () => {
  assert.equal(shouldRenderMyPageSection("all", "community"), true);
  assert.equal(shouldRenderMyPageSection("todo", "community"), false);
});
