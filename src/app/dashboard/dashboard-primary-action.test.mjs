import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("student dashboard does not render the onboarding primary action", async () => {
  const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");

  assert.match(source, /const shouldShowPrimaryAction = profile\.role !== "student";/);
  assert.match(source, /\{shouldShowPrimaryAction \? \(/);
  assert.match(source, /primaryHref: "\/onboarding"/);
});
