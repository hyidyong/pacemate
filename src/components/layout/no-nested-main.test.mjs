import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Stage 4 (audit D-1 / KI-016): AppShell renders the page's single <main>
// landmark (app-shell.tsx). Four components used to render a second <main>
// inside it — invalid HTML, duplicate landmark, and the same class of
// hydration-hostile markup as KI-013. This freezes the fix; the professor
// workspace has its own guard in professor-page-hydration.test.mjs.

const componentsRenderedInsideAppShell = [
  "../community/community-board.tsx",
  "../reviews/reviews-board.tsx",
  "../professor/professor-lounge.tsx",
  "../../app/professor/weekly-plan-preview/page.tsx",
];

for (const relativePath of componentsRenderedInsideAppShell) {
  test(`${relativePath.split("/").pop()} does not nest a <main> inside AppShell's main`, async () => {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");

    assert.doesNotMatch(
      source,
      /<main[\s>]/,
      `${relativePath} renders inside AppShell's <main>; use <section>/<div> with an aria-label instead`,
    );
  });
}

test("app-shell keeps the single main landmark", async () => {
  const source = await readFile(new URL("./app-shell.tsx", import.meta.url), "utf8");

  assert.match(source, /<main[\s>]/, "AppShell must keep rendering the page's main landmark");
});
