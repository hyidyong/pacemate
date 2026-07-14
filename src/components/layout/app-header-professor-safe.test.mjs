import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("professor desktop menus open on click without a scroll container clipping the dropdown", async () => {
  const source = await readFile(new URL("./app-header-professor-safe.tsx", import.meta.url), "utf8");

  assert.match(source, /openProfessorDesktopMenu/);
  assert.match(source, /onClick=\{\(\) => setOpenProfessorDesktopMenu/);
  assert.match(source, /overflow-visible/);
  assert.doesNotMatch(source, /professor-desktop-dropdown-nav[\s\S]*overflow-x-auto/);
});

test("professor header has the same profile icon destination as the mobile professor navigation", async () => {
  const source = await readFile(new URL("./app-header-professor-safe.tsx", import.meta.url), "utf8");

  assert.match(source, /href="\/professor\/mypage"/);
  assert.match(source, /UserCircle2/);
});
